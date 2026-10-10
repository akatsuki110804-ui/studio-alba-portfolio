"""STEP 5: assets — generation requests, imports, retries, diagram rendering.

Image/video generation runs through Higgsfield, which this project reaches via Claude Code's MCP tools
(there is no Higgsfield SDK call in this codebase). The flow is:

  1. `assets requests`  → writes assets/requests.json: one entry per pending cut, with the exact final
                           prompt, model, aspect ratio and estimated credits. A budget check runs first.
  2. Claude Code (or a person using the Higgsfield web app) generates each request.
  3. `assets import`     → copies a downloaded file in, verifies it, records cost, marks the cut ready.
     `assets fail`       → records a failed attempt; after `assets.max_retries` the cut is marked
                           failed_final and is never retried automatically.

State lives in assets/assets_state.json keyed by cut id, together with the fingerprint of the
prompt that produced the file. If the storyboard prompt changes, the old asset is reported stale.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

from . import cost_tracker, diagrams
from .common import PipelineError, Project, ffprobe, now_iso, read_json, sha, write_json

THUMB_FILE = ("thumbnails", "thumbnails.json")


def _state_path(project: Project) -> Path:
    return project.path("assets", "assets_state.json")


def load_state(project: Project) -> dict:
    return read_json(_state_path(project), {})


def save_state(project: Project, st: dict) -> None:
    write_json(_state_path(project), st)


def storyboard(project: Project) -> dict:
    sb = read_json(project.path("storyboard", "storyboard.json"))
    if not sb:
        raise PipelineError("storyboard/storyboard.json missing — run `plan` first")
    return sb


def final_prompt(cut: dict, style: dict) -> str:
    """Expand entity tags (EARTH, REEF, …) with their style-bible description on first mention."""
    p = cut["prompt"]
    for name, desc in style.get("entities", {}).items():
        if name in p:
            label = name.lower().replace("_", " ")
            head, _, tail = p.partition(name)
            p = f"{head}{label} ({desc}){tail.replace(name, label)}"
    return f"{p}. Style: {style['global_style']}. Avoid: {style.get('negative', '')}"


def fingerprint(cut: dict, style: dict) -> str:
    if cut["asset_type"] in ("diagram", "title"):
        return sha(cut["asset_type"], cut["diagram"])
    return sha(cut["asset_type"], final_prompt(cut, style))


def thumbnail_specs(project: Project) -> list[dict]:
    return (read_json(project.path(*THUMB_FILE), {}) or {}).get("thumbnails", [])


def generation_items(project: Project) -> list[dict]:
    """Everything that needs an AI-generated file: storyboard image/video cuts + thumbnail backgrounds."""
    sb = storyboard(project)
    style = sb["style_bible"]
    s = project.settings
    items = []
    for c in sb["cuts"]:
        if c["asset_type"] not in ("image", "video"):
            continue
        is_vid = c["asset_type"] == "video"
        items.append({
            "id": c["id"], "kind": c["asset_type"], "fingerprint": fingerprint(c, style),
            "provider": s["assets"]["image_provider"],
            "model": s["assets"]["video_model"] if is_vid else s["assets"]["image_model"],
            "aspect_ratio": "16:9", "prompt": final_prompt(c, style),
            "params": {"duration": 5, "mode": "std", "sound": "off"} if is_vid else {},
            "est_credits": s["pricing_credits"]["kling3_0_std_5s_silent"] if is_vid
            else s["pricing_credits"][s["assets"]["image_model"]],
            "dest": f"assets/{'video' if is_vid else 'images'}/{c['id']}.{'mp4' if is_vid else 'png'}",
        })
    for t in thumbnail_specs(project):
        items.append({
            "id": t["id"], "kind": "image", "fingerprint": sha("thumb", t["prompt"], style["global_style"]),
            "provider": s["assets"]["image_provider"], "model": s["assets"]["image_model"],
            "aspect_ratio": "16:9", "prompt": f"{t['prompt']}. Style: {style['global_style']}",
            "params": {}, "est_credits": s["pricing_credits"][s["assets"]["image_model"]],
            "dest": f"thumbnails/{t['id']}_bg.png",
        })
    return items


def status(project: Project) -> dict:
    st = load_state(project)
    out = {"ready": [], "pending": [], "stale": [], "failed_final": []}
    for it in generation_items(project):
        e = st.get(it["id"])
        if not e or e.get("status") in (None, "pending", "failed"):
            out["pending"].append(it["id"])
        elif e["status"] == "failed_final":
            out["failed_final"].append(it["id"])
        elif e.get("fingerprint") != it["fingerprint"] or not project.path(e["path"]).exists():
            out["stale"].append(it["id"])
        else:
            out["ready"].append(it["id"])
    return out


def write_requests(project: Project, confirmed: bool = False) -> dict:
    st = status(project)
    todo = set(st["pending"] + st["stale"])
    items = [it for it in generation_items(project) if it["id"] in todo]
    credits = round(sum(it["est_credits"] for it in items), 2)
    jpy = cost_tracker.credits_to_jpy(project, credits)
    by_stage = {"images": sum(cost_tracker.credits_to_jpy(project, i["est_credits"]) for i in items if i["kind"] == "image"),
                "video_clips": sum(cost_tracker.credits_to_jpy(project, i["est_credits"]) for i in items if i["kind"] == "video")}
    for stage, amount in by_stage.items():
        if amount:
            cost_tracker.check_budget(project, stage, amount, confirmed=confirmed)
    data = {"generated_at": now_iso(), "count": len(items), "est_credits": credits, "est_jpy": jpy,
            "note": "Estimates from settings.pricing_credits (Higgsfield get_cost preflight). "
                    "Record the actual charge on import.",
            "requests": items}
    write_json(project.path("assets", "requests.json"), data)
    return data


def import_asset(project: Project, item_id: str, file: Path, *, credits: float | None = None,
                 kind: str = "actual", job_id: str = "", provider: str | None = None, note: str = "") -> dict:
    items = {it["id"]: it for it in generation_items(project)}
    if item_id not in items:
        raise PipelineError(f"{item_id} is not an image/video cut or thumbnail in this project")
    it = items[item_id]
    file = Path(file)
    if not file.exists():
        raise PipelineError(f"file not found: {file}")
    dest = project.path(it["dest"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    if it["kind"] == "image":
        with Image.open(file) as im:
            im.load()
            w, h = im.size
            if w < 1000 or abs(w / h - 16 / 9) > 0.08:
                raise PipelineError(f"{item_id}: image is {w}×{h}; need ≥1000 px wide and ~16:9")
            im.convert("RGB").save(dest)
    else:
        info = ffprobe(file)
        v = [s for s in info["streams"] if s["codec_type"] == "video"]
        if not v:
            raise PipelineError(f"{item_id}: no video stream in {file}")
        shutil.copyfile(file, dest)
    st = load_state(project)
    e = st.get(item_id, {"attempts": 0})
    e.update({"status": "ready", "path": it["dest"], "fingerprint": it["fingerprint"], "imported": now_iso(),
              "provider": provider or it["provider"], "model": it["model"], "job_id": job_id,
              "prompt": it["prompt"], "attempts": e.get("attempts", 0) + 1, "last_error": None})
    st[item_id] = e
    save_state(project, st)
    c = it["est_credits"] if credits is None else credits
    cost_tracker.record(project, stage="video_clips" if it["kind"] == "video" else "images", item=item_id,
                        provider=e["provider"], model=it["model"], credits=c,
                        kind="estimate" if credits is None else kind, note=note or job_id)
    project.log("assets", "imported", item=item_id, path=it["dest"], credits=c, job_id=job_id)
    return e


def record_failure(project: Project, item_id: str, error: str, credits: float = 0.0) -> dict:
    st = load_state(project)
    e = st.get(item_id, {"attempts": 0})
    e["attempts"] = e.get("attempts", 0) + 1
    e["last_error"] = error
    limit = int(project.settings["assets"]["max_retries"]) + 1
    e["status"] = "failed_final" if e["attempts"] >= limit else "failed"
    st[item_id] = e
    save_state(project, st)
    if credits:
        cost_tracker.record(project, stage="images", item=item_id, provider="higgsfield", credits=credits,
                            kind="actual", note=f"failed attempt: {error[:80]}")
    project.log("assets", "failed", item=item_id, error=error, attempts=e["attempts"], final=e["status"])
    return e


def render_code_assets(project: Project) -> list[str]:
    """Diagrams and title cards are drawn locally; re-rendered only when their spec changes."""
    sb = storyboard(project)
    st = load_state(project)
    done = []
    for c in sb["cuts"]:
        if c["asset_type"] not in ("diagram", "title"):
            continue
        fp = fingerprint(c, sb["style_bible"])
        rel = f"assets/diagrams/{c['id']}.png"
        e = st.get(c["id"], {})
        if e.get("fingerprint") == fp and project.path(rel).exists():
            continue
        diagrams.render(c["diagram"], project.path(rel))
        st[c["id"]] = {"status": "ready", "path": rel, "fingerprint": fp, "provider": "local (Pillow)",
                       "imported": now_iso(), "attempts": 1}
        done.append(c["id"])
    save_state(project, st)
    if done:
        cost_tracker.record(project, stage="diagrams", item=f"{len(done)} diagrams", provider="local (Pillow)",
                            units=len(done), cost_jpy=0, kind="free")
    return done


def cut_asset(project: Project, cut: dict, style: dict) -> Path | None:
    """Path to a ready, non-stale asset for a cut, else None."""
    e = load_state(project).get(cut["id"])
    if not e or e.get("status") != "ready" or e.get("fingerprint") != fingerprint(cut, style):
        return None
    p = project.path(e["path"])
    return p if p.exists() else None


def download(project: Project, item_id: str, url: str, timeout: int = 300) -> Path:
    """Fetch a generated file into assets/incoming/ (kept for audit) and return its path."""
    import requests

    suffix = Path(url.split("?")[0]).suffix or ".bin"
    out = project.path("assets", "incoming", f"{item_id}{suffix}")
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        with requests.get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            with out.open("wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
    except requests.RequestException as e:
        raise PipelineError(f"{item_id}: download failed ({e}). Is the host allowed by the network policy?") from e
    return out
