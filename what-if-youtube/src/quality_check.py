"""STEP 10: automated QC + review previews + production report.

Automated checks catch mechanical problems. They do not judge accuracy, taste or originality —
a person must watch the video before anything is published.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image

from . import asset_manager as am
from . import cost_tracker
from .common import Project, ffprobe, now_iso, read_json, run, write_json


def _check(results: list, name: str, ok: bool, detail: str = "", severity: str = "error") -> None:
    results.append({"check": name, "ok": bool(ok), "severity": "info" if ok else severity, "detail": detail})


def loudness(path: Path) -> dict:
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
    summ = out[out.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+) LUFS", summ)
    p = re.search(r"Peak:\s+(-?[\d.]+) dBFS", summ)
    return {"lufs": float(i.group(1)) if i else None, "true_peak": float(p.group(1)) if p else None}


def black_runs(path: Path, min_d: float = 1.0) -> list[tuple[float, float]]:
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vf", f"blackdetect=d={min_d}:pix_th=0.06",
               "-an", "-f", "null", "-"]).stderr
    return [(float(a), float(b)) for a, b in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", out)]


def silence_runs(path: Path, min_d: float = 3.0) -> list[float]:
    out = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", f"silencedetect=n=-45dB:d={min_d}",
               "-vn", "-f", "null", "-"]).stderr
    return [float(x) for x in re.findall(r"silence_duration: ([\d.]+)", out)]


def check_video(results: list, path: Path, *, w: int, h: int, dur_range: tuple[float, float], s: dict) -> dict:
    name = path.name
    try:
        info = ffprobe(path)
    except Exception as e:  # noqa: BLE001
        _check(results, f"{name}: opens", False, str(e))
        return {}
    v = [x for x in info["streams"] if x["codec_type"] == "video"]
    a = [x for x in info["streams"] if x["codec_type"] == "audio"]
    dur = float(info["format"]["duration"])
    _check(results, f"{name}: opens with video+audio", bool(v and a), f"video={len(v)} audio={len(a)}")
    if v:
        _check(results, f"{name}: resolution {w}×{h}", (v[0]["width"], v[0]["height"]) == (w, h),
               f"{v[0]['width']}×{v[0]['height']}")
    _check(results, f"{name}: duration in {dur_range[0]:.0f}–{dur_range[1]:.0f}s",
           dur_range[0] <= dur <= dur_range[1], f"{dur:.1f}s")
    ld = loudness(path)
    tgt = float(s["audio"]["target_lufs"])
    _check(results, f"{name}: loudness ≈ {tgt} LUFS", ld["lufs"] is not None and abs(ld["lufs"] - tgt) <= 1.5,
           f"{ld['lufs']} LUFS")
    _check(results, f"{name}: true peak ≤ -1 dBTP", ld["true_peak"] is not None and ld["true_peak"] <= -0.9,
           f"{ld['true_peak']} dBTP")
    blk = [r for r in black_runs(path) if r[1] - r[0] > 1.0]
    _check(results, f"{name}: no black runs > 1s", not blk, json.dumps(blk), "warning")
    sil = silence_runs(path)
    _check(results, f"{name}: no silence > 3s", not sil, json.dumps(sil), "warning")
    return {"duration": dur, **ld}


def check_srt(results: list, srt: Path, duration: float) -> None:
    if not srt.exists():
        _check(results, f"{srt.name}: exists", False)
        return
    blocks = [b for b in srt.read_text().strip().split("\n\n") if b.strip()]

    def secs(ts: str) -> float:
        h, m, rest = ts.split(":")
        s_, ms = rest.split(",")
        return int(h) * 3600 + int(m) * 60 + int(s_) + int(ms) / 1000

    prev_end, bad = 0.0, []
    for b in blocks:
        ln = b.split("\n")
        a, _, z = ln[1].partition(" --> ")
        st, en = secs(a), secs(z)
        if st < prev_end - 0.001 or en <= st or len(ln) > 4 or any(len(x) > 48 for x in ln[2:]):
            bad.append(ln[0])
        prev_end = en
    _check(results, f"{srt.name}: {len(blocks)} cues ordered, non-overlapping, ≤2 lines", not bad, f"bad cues: {bad[:10]}")
    _check(results, f"{srt.name}: ends before video ends", prev_end <= duration + 0.05, f"last cue {prev_end:.2f}s")


def check_tts(results: list, timing: dict, label: str) -> None:
    odd = []
    for u in timing["units"]:
        for snt in u["sentences"]:
            wps = len(snt["text"].split()) / max(0.01, snt["end"] - snt["start"])
            if not 1.3 <= wps <= 4.8:
                odd.append(f"{u['id']}: {wps:.1f} w/s “{snt['text'][:40]}”")
    _check(results, f"{label}: speech rate plausible for every sentence", not odd, "; ".join(odd[:8]), "warning")


def previews(project: Project, video: Path, tag: str) -> list[str]:
    out = []
    sheet = project.path("previews", f"{tag}_contact_sheet.jpg")
    info = ffprobe(video)
    dur = float(info["format"]["duration"])
    step = max(1.0, dur / 16)
    vert = info["streams"][0].get("height", 0) > info["streams"][0].get("width", 0)
    scale = "270:480" if vert else "480:270"
    tile = "6x1" if vert else "4x4"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vf",
         f"fps=1/{step:.3f},scale={scale},tile={tile}", "-frames:v", "1", "-q:v", "4", str(sheet)])
    out.append(str(sheet.relative_to(project.dir)))
    if not vert:
        sample = project.path("previews", f"{tag}_audio_sample.mp3")
        run(["ffmpeg", "-y", "-v", "error", "-ss", "0", "-t", "45", "-i", str(video), "-vn", "-b:a", "128k", str(sample)])
        out.append(str(sample.relative_to(project.dir)))
    return out


def validate(project: Project) -> dict:
    s = project.settings
    results: list[dict] = []
    summary: dict = {"generated": now_iso(), "project": project.slug, "videos": {}, "previews": []}
    with project.stage("validate") as rec:
        # --- research & sources
        research = read_json(project.path("research", "research.json"))
        _check(results, "research: saved with sources", bool(research and research["sources"]),
               f"{len(research['sources']) if research else 0} sources")
        if research:
            _check(results, "research: status complete", research["research_status"] == "complete",
                   research["research_status"])
            unv = [c["id"] for c in research["claims"] if c["category"] == "fact" and c["status"] == "unverified"]
            _check(results, "research: no unverified fact claims", not unv, str(unv))
            partial = [c["id"] for c in research["claims"] if c["status"] == "partially_verified"]
            _check(results, "research: claims only partially verified (human should check)", not partial,
                   ", ".join(partial), "warning")

        # --- assets
        st = am.status(project)
        _check(results, "assets: none failed permanently", not st["failed_final"], str(st["failed_final"]))
        _check(results, "assets: none stale (prompt changed since generation)", not st["stale"], str(st["stale"]))
        _check(results, "assets: all AI shots generated", not st["pending"], f"pending: {st['pending']}", "error")

        # --- long form
        lo, hi = s["video"]["target_minutes"]
        lf = s["video"]["long_form"]
        final = project.path("output", f"{project.slug}_long.mp4")
        draft = project.path("output", f"{project.slug}_long_ANIMATIC.mp4")
        long_path = final if final.exists() else draft
        publishable = final.exists()
        if long_path.exists():
            summary["videos"]["long"] = {"file": str(long_path.relative_to(project.dir)),
                                         **check_video(results, long_path, w=lf["width"], h=lf["height"],
                                                       dur_range=(lo * 60 - 15, hi * 60 + 15), s=s)}
            check_srt(results, project.path("subtitles", f"{project.slug}_en.srt"), summary["videos"]["long"]["duration"])
            summary["previews"] += previews(project, long_path, "long")
        _check(results, "long-form: final (non-animatic) render exists", final.exists(),
               "only the ANIMATIC draft exists" if draft.exists() and not final.exists() else "")
        timing = read_json(project.path("audio", "timing.json"))
        if timing:
            check_tts(results, timing, "long narration")

        # --- shorts
        sf = s["video"]["short_form"]
        slo, shi = s["video"]["shorts_seconds"]
        man = read_json(project.path("output", "shorts", "shorts_manifest.json"), [])
        _check(results, "shorts: 2–3 produced", 2 <= len(man) <= 3, f"{len(man)}")
        for m in man:
            p = project.path(m["output"])
            summary["videos"][m["id"]] = {"file": m["output"], **check_video(
                results, p, w=sf["width"], h=sf["height"], dur_range=(slo, shi), s=s)}
            summary["previews"] += previews(project, p, m["id"])
            if m["placeholder_cuts"]:
                publishable = False
            t = read_json(project.path("audio", "shorts", f"{m['id']}_timing.json"))
            if t:
                check_tts(results, t, f"{m['id']} narration")

        # --- thumbnails
        tman = read_json(project.path("thumbnails", "thumbnails_manifest.json"), [])
        _check(results, "thumbnails: 3 candidates", len(tman) == 3, f"{len(tman)}")
        for t in tman:
            p = project.path(t["output"])
            with Image.open(p) as im:
                _check(results, f"{p.name}: 1280×720, < 2 MB", im.size == (1280, 720) and p.stat().st_size < 2_000_000,
                       f"{im.size}, {p.stat().st_size // 1024} KB")
            if not t["publishable"]:
                publishable = False
                _check(results, f"{p.name}: real background", False, "draft background", "warning")

        # --- cost
        cs = cost_tracker.summary(project)
        _check(results, "cost: ledger recorded", cs["rows"] > 0, f"¥{cs['total_jpy']} / {cs['total_credits']} credits")
        _check(results, "cost: within per-video budget", cs["total_jpy"] <= s["budget"]["per_video_limit_jpy"],
               f"¥{cs['total_jpy']} of ¥{s['budget']['per_video_limit_jpy']}")

        errors = [r for r in results if not r["ok"] and r["severity"] == "error"]
        summary.update({"publishable": publishable and not errors, "errors": len(errors),
                        "warnings": sum(1 for r in results if not r["ok"] and r["severity"] == "warning"),
                        "checks": results, "cost": {k: v for k, v in cs.items() if k != "rows"},
                        "human_review_required": True})
        write_json(project.path("reports", "qc_report.json"), summary)
        _write_qc_md(project, summary)
        rec["outputs"] += ["reports/qc_report.json", "reports/qc_report.md"]
        rec["notes"].append(f"errors={len(errors)} warnings={summary['warnings']} publishable={summary['publishable']}")
    return summary


def _write_qc_md(project: Project, q: dict) -> None:
    icon = {"info": "✅", "warning": "⚠️", "error": "❌"}
    lines = [f"# QC report — {project.slug}", "", f"Generated: {q['generated']}", "",
             f"**Publishable:** {'yes' if q['publishable'] else 'NO'} · errors {q['errors']} · warnings {q['warnings']}",
             "", "> Automated checks are not a substitute for watching the video. A person must review "
             "accuracy, visuals and audio before publishing.", "", "| | check | detail |", "|---|---|---|"]
    for r in q["checks"]:
        lines.append(f"| {icon[r['severity']]} | {r['check']} | {r['detail'][:160].replace('|', '/')} |")
    lines += ["", "## Cost", "", f"Total: ¥{q['cost']['total_jpy']} ({q['cost']['total_credits']} credits). "
              f"Month to date: ¥{q['cost']['month_total_jpy']}.", "", "| stage | items | credits | ¥ | kind |",
              "|---|---|---|---|---|"]
    for k, v in q["cost"]["by_stage"].items():
        lines.append(f"| {k} | {v['items']} | {v['credits']} | {v['cost_jpy']} | {', '.join(v['kinds'])} |")
    lines += ["", "## Previews", *[f"- {p}" for p in q["previews"]]]
    project.path("reports", "qc_report.md").write_text("\n".join(lines) + "\n")
