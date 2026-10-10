"""STEP 1: plan, STEP 2: research, STEP 3: script, STEP 4: storyboard (+ shorts design)."""
from __future__ import annotations

from . import llm
from .common import PipelineError, Project, read_json, sha


def plan(project: Project, force: bool = False) -> dict:
    s = project.settings["video"]["target_minutes"]
    with project.stage("plan", {"topic": project.meta["topic"]}) as rec:
        data = llm.run_stage(project, "plan", project.path("plan", "plan.json"), force=force,
                             topic=project.meta["topic"], min_seconds=s[0] * 60, max_seconds=s[1] * 60)
        rec["outputs"].append("plan/plan.json")
    return data


def research(project: Project, force: bool = False) -> dict:
    p = read_json(project.path("plan", "plan.json"))
    with project.stage("research") as rec:
        data = llm.run_stage(project, "research", project.path("research", "research.json"), force=force,
                             topic=project.meta["topic"], plan=p)
        ids = {s["id"] for s in data["sources"]}
        missing = [c["id"] for c in data["claims"] for sid in c["source_ids"] if sid not in ids]
        if missing:
            raise PipelineError(f"research: claims cite unknown source ids: {sorted(set(missing))}")
        if data["research_status"] != "complete":
            rec["notes"].append(f"research_status={data['research_status']} — human review required")
        rec["outputs"].append("research/research.json")
        _write_sources_md(project, data)
    return data


def _write_sources_md(project: Project, data: dict) -> None:
    lines = ["# Sources and claims", "", f"Research status: **{data['research_status']}**", "",
             "## Assumptions", *[f"- {a}" for a in data["assumptions"]], "", "## Claims", "",
             "| id | category | status | claim | sources |", "|---|---|---|---|---|"]
    for c in data["claims"]:
        lines.append(f"| {c['id']} | {c['category']} | {c['status']} | {c['text']} | {', '.join(c['source_ids'])} |")
    lines += ["", "## Sources", ""]
    for s in data["sources"]:
        lines.append(f"- **{s['id']}** — {s['title']} ({s.get('publisher', '')}). {s['url']} "
                     f"— checked via: {s['access_method']}")
    if data["open_questions"]:
        lines += ["", "## Open questions", *[f"- {q}" for q in data["open_questions"]]]
    project.path("research", "sources.md").write_text("\n".join(lines) + "\n")


def script(project: Project, force: bool = False) -> dict:
    p = read_json(project.path("plan", "plan.json"))
    r = read_json(project.path("research", "research.json"))
    with project.stage("script") as rec:
        data = llm.run_stage(project, "script", project.path("scripts", "script.json"), force=force,
                             topic=project.meta["topic"], plan=p, research=r)
        claims = {c["id"]: c for c in r["claims"]}
        bad, unknown = [], []
        for sec in data["sections"]:
            for ln in sec["lines"]:
                for cid in ln["claim_ids"]:
                    if cid not in claims:
                        unknown.append(f"{ln['id']}→{cid}")
                    elif claims[cid]["category"] == "fact" and claims[cid]["status"] == "unverified":
                        bad.append(f"{ln['id']}→{cid}")
        if unknown:
            raise PipelineError(f"script cites unknown claim ids: {unknown}")
        if bad:
            raise PipelineError(f"script relies on unverified fact claims: {bad}")
        words = sum(len(ln["text"].split()) for sec in data["sections"] for ln in sec["lines"])
        rec["notes"].append(f"{words} words ≈ {words / 150:.1f} min at 150 wpm")
        _write_script_md(project, data, claims)
        rec["outputs"] += ["scripts/script.json", "scripts/script.md"]
    return data


def _write_script_md(project: Project, data: dict, claims: dict) -> None:
    out = [f"# {data['title']}", ""]
    for sec in data["sections"]:
        out += [f"## {sec['name']}", ""]
        for ln in sec["lines"]:
            refs = ", ".join(f"{c} [{claims[c]['category']}]" for c in ln["claim_ids"])
            out.append(f"**{ln['id']}** {ln['text']}" + (f"  \n  _claims: {refs}_" if refs else ""))
            out.append("")
    project.path("scripts", "script.md").write_text("\n".join(out))


def script_lines(script_data: dict) -> list[dict]:
    return [dict(ln, section=sec["id"]) for sec in script_data["sections"] for ln in sec["lines"]]


def storyboard(project: Project, force: bool = False) -> dict:
    sc = read_json(project.path("scripts", "script.json"))
    r = read_json(project.path("research", "research.json"))
    with project.stage("storyboard") as rec:
        data = llm.run_stage(project, "storyboard", project.path("storyboard", "storyboard.json"),
                             force=force, script=sc, research=r)
        lines = {ln["id"]: ln for ln in script_lines(sc)}
        problems = []
        seen = set()
        for c in data["cuts"]:
            if c["id"] in seen:
                problems.append(f"duplicate cut id {c['id']}")
            seen.add(c["id"])
            if c["line_id"] not in lines:
                problems.append(f"{c['id']}: unknown line_id {c['line_id']}")
            if c["asset_type"] in ("image", "video") and not c["prompt"]:
                problems.append(f"{c['id']}: {c['asset_type']} cut needs a prompt")
            if c["asset_type"] == "diagram" and not c["diagram"]:
                problems.append(f"{c['id']}: diagram cut needs a diagram spec")
        covered = {c["line_id"] for c in data["cuts"]}
        problems += [f"script line {lid} has no cut" for lid in lines if lid not in covered]
        if problems:
            raise PipelineError("storyboard problems:\n  - " + "\n  - ".join(problems))
        rec["outputs"].append("storyboard/storyboard.json")
        rec["notes"].append(f"{len(data['cuts'])} cuts: " + ", ".join(
            f"{t}={sum(c['asset_type'] == t for c in data['cuts'])}" for t in ("image", "video", "diagram", "title")))

    sb_cuts = [{"id": c["id"], "narration": c["narration"]} for c in data["cuts"]]
    with project.stage("shorts_plan") as rec:
        llm.run_stage(project, "shorts", project.path("shorts", "shorts.json"), force=force,
                      script=sc, cuts=sb_cuts, research=r)
        rec["outputs"].append("shorts/shorts.json")
    return data


def cut_fingerprint(cut: dict, style: dict) -> str:
    """Changes when anything that affects the generated asset changes."""
    return sha(cut["asset_type"], cut.get("prompt"), cut.get("diagram"), style.get("global_style"))


def write_storyboard_md(project: Project) -> None:
    sb = read_json(project.path("storyboard", "storyboard.json"))
    out = ["# Storyboard", "", "| cut | type | camera | narration | visual |", "|---|---|---|---|---|"]
    for c in sb["cuts"]:
        vis = c["prompt"] if c["prompt"] else f"diagram: {c['diagram'].get('type') if c['diagram'] else ''}"
        out.append(f"| {c['id']} | {c['asset_type']} | {c['camera_motion']} | {c['narration']} | {vis} |")
    project.path("storyboard", "storyboard.md").write_text("\n".join(out) + "\n")
