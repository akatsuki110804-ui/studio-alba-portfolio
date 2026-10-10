"""STEP 8: Shorts (9:16) derived from the long-form project.

Each short has its own narration (written to stand alone: hook → one question → payoff → pointer to the
full video), reuses long-form cut visuals, and is re-composed for vertical: a blurred, darkened copy of the
shot fills the frame and the shot itself sits in the upper-middle, leaving room for a hook header at the
top and large subtitles below.
"""
from __future__ import annotations

import textwrap
from pathlib import Path

from . import asset_manager as am
from . import cost_tracker, editor, voice
from .common import PipelineError, Project, read_json, run, sha, write_json

FG_Y_OFFSET = -110  # shot sits slightly above center


def _claims_ok(project: Project, short: dict) -> None:
    research = read_json(project.path("research", "research.json"))
    claims = {c["id"]: c for c in research["claims"]}
    for ln in short["lines"]:
        for cid in ln["claim_ids"]:
            if cid not in claims:
                raise PipelineError(f"{short['id']}: unknown claim id {cid}")
            if claims[cid]["category"] == "fact" and claims[cid]["status"] == "unverified":
                raise PipelineError(f"{short['id']}: relies on unverified claim {cid}")


def vertical_segment(src: Path, kind: str, motion: str, frames: int, out: Path, *, fps: int,
                     w: int = 1080, h: int = 1920) -> Path:
    fw, fh = w, round(w * 9 / 16 / 2) * 2
    if kind == "video":
        base = (f"scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps={fps},"
                f"tpad=stop_mode=clone:stop_duration={frames / fps:.3f}")
    else:
        base = ("scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,"
                + editor._zoompan(motion, frames, 1920, 1080, fps))
    fc = (f"[0:v]{base},split=2[a][b];"
          f"[a]scale=-2:{h},crop={w}:{h},gblur=sigma=28,eq=brightness=-0.18:saturation=0.8[bg];"
          f"[b]scale={fw}:{fh}[fg];"
          f"[bg][fg]overlay=(W-w)/2:(H-h)/2+({FG_Y_OFFSET}),format=yuv420p,setsar=1[v]")
    out.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-filter_complex", fc, "-map", "[v]",
         "-frames:v", str(frames), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
         "-r", str(fps), str(out)])
    return out


def build_short(project: Project, short: dict, animatic: bool) -> dict:
    _claims_ok(project, short)
    sb = am.storyboard(project)
    cuts = {c["id"]: c for c in sb["cuts"]}
    vcfg = project.settings["video"]["short_form"]
    fps = vcfg["fps"]
    sid = short["id"]
    units = [{"id": f"{sid}_L{i + 1:02d}", "text": ln["text"]} for i, ln in enumerate(short["lines"])]
    adir = project.path("audio", "shorts")
    timing = voice.build_track(project, units, adir / f"{sid}.wav", adir / f"{sid}_timing.json", lead_in=0.3)
    lo, hi = project.settings["video"]["shorts_seconds"]
    if not lo <= timing["duration"] <= hi:
        raise PipelineError(f"{sid}: narration is {timing['duration']:.1f}s, outside {lo}–{hi}s — edit shorts.json")

    seg_dir = project.path("output", "shorts", "segments")
    seg_paths, placeholders = [], []
    for i, (ln, u) in enumerate(zip(short["lines"], timing["units"])):
        cut = cuts.get(ln["cut_id"])
        if not cut:
            raise PipelineError(f"{sid}: unknown cut {ln['cut_id']}")
        start = 0.0 if i == 0 else u["start"]
        end = timing["units"][i + 1]["start"] if i + 1 < len(units) else timing["duration"]
        frames = round(end * fps) - round(start * fps)
        src = am.cut_asset(project, cut, sb["style_bible"])
        kind, motion = cut["asset_type"], cut["camera_motion"]
        if src is None:
            if not animatic:
                raise PipelineError(f"{sid}: cut {cut['id']} has no ready asset (use --animatic for a draft)")
            src, kind, motion = editor.placeholder_card(project, cut), "image", "static"
            placeholders.append(cut["id"])
        if kind in ("diagram", "title"):
            kind = "image"
        st = src.stat()
        key = sha(str(src), st.st_size, st.st_mtime, kind, motion, frames)
        out = seg_dir / f"{sid}_{i:02d}_{key}.mp4"
        if not out.exists():
            for old in seg_dir.glob(f"{sid}_{i:02d}_*.mp4"):
                old.unlink()
            vertical_segment(src, kind, motion, frames, out, fps=fps)
        seg_paths.append(out)

    video_only = editor.concat(seg_paths, project.path("output", "shorts", f"{sid}_video_only.mp4"))
    sub = project.settings["subtitles"]
    events = editor.subtitle_events(timing, 24, 2)
    last_start = timing["units"][-1]["start"]
    end_t = timing["duration"]
    hook = editor.BREAK.join(textwrap.wrap(short["hook_text"].upper(), 18))
    endc = editor.BREAK.join(textwrap.wrap(short["end_card_text"], 22))
    header = [
        f"Dialogue: 1,{editor._ts_ass(0)},{editor._ts_ass(last_start)},Hook,,0,0,0,,{hook}",
        f"Dialogue: 1,{editor._ts_ass(last_start)},{editor._ts_ass(end_t)},Hook,,0,0,0,,{endc}",
    ]
    styles = (f"Style: Hook,{sub['font']},78,&H0047B5FF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,4,1,8,"
              f"60,60,170,1\n")
    ass = project.path("subtitles", f"{sid}_burn.ass")
    editor.write_ass(events, ass, w=vcfg["width"], h=vcfg["height"], font=sub["font"],
                     size=sub["short_font_size"], margin_v=470, extra_styles=styles, extra_events=header)
    editor.write_srt(events, project.path("subtitles", f"{sid}_en.srt"))
    mix = project.path("audio", "shorts", f"{sid}_mix.wav")
    editor.mix_audio(project, adir / f"{sid}.wav", end_t, mix)
    suffix = "_ANIMATIC" if placeholders else ""
    out = project.path("output", "shorts", f"{sid}{suffix}.mp4")
    run(["ffmpeg", "-y", "-v", "error", "-i", str(video_only), "-i", str(mix), "-vf", f"ass={ass}",
         "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", project.settings["video"]["preset"],
         "-crf", str(project.settings["video"]["crf"]), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", project.settings["audio"]["aac_bitrate"],
         "-movflags", "+faststart", "-t", f"{end_t:.3f}", str(out)])
    video_only.unlink(missing_ok=True)
    return {"id": sid, "title": short["title"], "output": str(out.relative_to(project.dir)),
            "duration": end_t, "placeholder_cuts": placeholders, "generated_sentences": timing["generated"]}


def make_shorts(project: Project, animatic: bool = False) -> list[dict]:
    spec = read_json(project.path("shorts", "shorts.json"))
    if not spec:
        raise PipelineError("shorts/shorts.json missing — run `plan` first")
    with project.stage("shorts", {"count": len(spec["shorts"]), "animatic": animatic}) as rec:
        results = [build_short(project, s, animatic) for s in spec["shorts"]]
        write_json(project.path("output", "shorts", "shorts_manifest.json"), results)
        rec["outputs"] += [r["output"] for r in results]
        gen = sum(r["generated_sentences"] for r in results)
        if gen:
            cost_tracker.record(project, stage="voice", item="shorts narration", provider="kokoro (local)",
                                units=gen, cost_jpy=0, kind="free")
    return results
