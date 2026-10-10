"""STEP 7: long-form edit with FFmpeg.

cut assets ─► per-cut segments (Ken Burns / trimmed video, cached) ─► concat ─┐
narration.wav + music bed ─► duck + loudnorm (two-pass) ──────────────────────┼─► mux + burned ASS subtitles
timing.json ─► subtitles (.ass for burn-in, .srt for YouTube upload) ─────────┘

Missing assets stop the edit with an error. `animatic=True` instead renders a labelled placeholder card
for each missing cut and names the output *_ANIMATIC.mp4 so it can never be mistaken for a final cut.
"""
from __future__ import annotations

import json
import math
import re
import textwrap
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from . import asset_manager as am
from . import diagrams
from .common import PipelineError, Project, media_duration, read_json, run, sha, write_json

END_CARD_SECONDS = 4.0
BREAK = "\\N"  # ASS hard line break
SECTION_FADE = 0.35


# ------------------------------------------------------------------ motion
def _zoompan(motion: str, frames: int, w: int, h: int, fps: int) -> str:
    n = max(frames, 1)
    c = {"x": "(iw-iw/zoom)/2", "y": "(ih-ih/zoom)/2"}
    z = {"push_in": f"1.0+0.12*on/{n}", "pull_out": f"1.12-0.12*on/{n}", "static": f"1.0+0.03*on/{n}"}.get(motion, "1.12")
    if motion == "pan_left":
        c["x"] = f"(iw-iw/zoom)*(1-on/{n})"
    elif motion == "pan_right":
        c["x"] = f"(iw-iw/zoom)*on/{n}"
    elif motion == "tilt_up":
        c["y"] = f"(ih-ih/zoom)*(1-on/{n})"
    elif motion == "tilt_down":
        c["y"] = f"(ih-ih/zoom)*on/{n}"
    return f"zoompan=z='{z}':x='{c['x']}':y='{c['y']}':d={n}:s={w}x{h}:fps={fps}"


def render_segment(src: Path, kind: str, motion: str, frames: int, out: Path, *, w: int, h: int, fps: int,
                   fade_in: bool = False, fade_out: bool = False, crf: int = 18) -> Path:
    dur = frames / fps
    fades = []
    if fade_in:
        fades.append(f"fade=t=in:st=0:d={SECTION_FADE}")
    if fade_out:
        fades.append(f"fade=t=out:st={max(0.0, dur - SECTION_FADE):.3f}:d={SECTION_FADE}")
    if kind == "video":
        vf = [f"scale={w}:{h}:force_original_aspect_ratio=increase", f"crop={w}:{h}", f"fps={fps}",
              f"tpad=stop_mode=clone:stop_duration={dur:.3f}"]
        inp = ["-i", str(src)]
    else:
        vf = [f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase", f"crop={w * 2}:{h * 2}",
              _zoompan(motion, frames, w, h, fps)]
        inp = ["-i", str(src)]
    vf += fades + ["format=yuv420p", "setsar=1"]
    out.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-v", "error", *inp, "-vf", ",".join(vf), "-frames:v", str(frames), "-an",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), "-r", str(fps), str(out)])
    return out


# ------------------------------------------------------------------ cards
def placeholder_card(project: Project, cut: dict, w: int = 1920, h: int = 1080) -> Path:
    out = project.path("previews", "placeholders", f"{cut['id']}.png")
    img, d = diagrams.canvas()
    d.rectangle([0, 0, w, h], fill=(32, 34, 40))
    d.rectangle([0, 0, w, 110], fill=(150, 30, 40))
    diagrams.center_text(d, 22, "ANIMATIC — PENDING ASSET — NOT FOR PUBLISHING", diagrams.font(54, "Bold"))
    d.text((120, 200), f"{cut['id']}  ·  {cut['asset_type'].upper()}  ·  {cut['camera_motion']}",
           font=diagrams.font(64, "Bold"), fill=(240, 240, 240))
    d.text((120, 300), cut["purpose"], font=diagrams.font(44, "SemiBold"), fill=(255, 200, 120))
    y = 400
    for line in textwrap.wrap(cut.get("prompt") or "", 78)[:9]:
        d.text((120, y), line, font=diagrams.font(36, "Regular"), fill=(190, 195, 205))
        y += 52
    out.parent.mkdir(parents=True, exist_ok=True)
    img.resize((w, h)).save(out)
    return out


def end_card(project: Project, title: str) -> Path:
    out = project.path("previews", "end_card.png")
    img, d = diagrams.canvas()
    diagrams.center_text(d, 380, "WHAT IF SCIENCE", diagrams.font(96, "Bold"), diagrams.CYAN)
    diagrams.center_text(d, 520, title, diagrams.font(48, "SemiBold"))
    diagrams.center_text(d, 640, "Sources and assumptions are listed in the description.",
                         diagrams.font(36, "Regular"), diagrams.MUTED)
    img.save(out)
    return out


# ------------------------------------------------------------------ subtitles
def chunk_sentence(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    parts = re.split(r"(?<=[,;:—])\s+", text)
    chunks, cur = [], ""
    for p in parts:
        for word in p.split(" "):
            if cur and len(cur) + 1 + len(word) > max_chars:
                chunks.append(cur)
                cur = word
            else:
                cur = f"{cur} {word}".strip()
        if len(cur) > max_chars * 0.55:
            chunks.append(cur)
            cur = ""
    if cur:
        chunks.append(cur)
    return chunks


def wrap_lines(text: str, max_line: int) -> list[str]:
    if len(text) <= max_line:
        return [text]
    words = text.split()
    best, best_score = [text], 10 ** 9
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        score = max(len(a), len(b))
        if score < best_score:
            best, best_score = [a, b], score
    return best


def subtitle_events(timing: dict, max_line: int, max_lines: int) -> list[dict]:
    ev = []
    for u in timing["units"]:
        for s in u["sentences"]:
            chunks = chunk_sentence(s["text"], max_line * max_lines)
            total = sum(len(c) for c in chunks)
            t = s["start"]
            for c in chunks:
                dur = (s["end"] - s["start"]) * len(c) / total
                ev.append({"start": t, "end": t + dur, "lines": wrap_lines(c, max_line), "unit": u["id"]})
                t += dur
    # keep each event on screen through the short pause that follows it, never overlapping the next
    for a, b in zip(ev, ev[1:]):
        a["end"] = min(b["start"] - 0.02, a["end"] + 0.25)
    return ev


def _ts_srt(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def _ts_ass(t: float) -> str:
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def write_srt(events: list[dict], out: Path) -> None:
    lines = []
    for i, e in enumerate(events, 1):
        lines += [str(i), f"{_ts_srt(e['start'])} --> {_ts_srt(e['end'])}", *e["lines"], ""]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines))


def write_ass(events: list[dict], out: Path, *, w: int, h: int, font: str, size: int, margin_v: int,
              extra_styles: str = "", extra_events: list[str] = ()) -> None:
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,{font},{size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,{max(2, size // 18)},1,2,80,80,{margin_v},1
{extra_styles}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    body = [f"Dialogue: 0,{_ts_ass(e['start'])},{_ts_ass(e['end'])},Sub,,0,0,0,,{BREAK.join(e['lines'])}"
            for e in events]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(head + "\n".join(list(extra_events) + body) + "\n")


# ------------------------------------------------------------------ audio
def music_bed(path: Path, seconds: float, sr: int = 44100, seed: int = 11) -> Path:
    """Self-generated ambient pad (slow chords + filtered noise). No third-party rights involved."""
    if path.exists() and abs(media_duration(path) - seconds) < 0.05:
        return path
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    chords = [[110.0, 164.81, 220.0, 261.63], [87.31, 130.81, 174.61, 220.0],
              [98.0, 146.83, 196.0, 246.94], [82.41, 123.47, 164.81, 207.65]]  # Am F G E
    seg = 12.0
    out = np.zeros(n, np.float32)
    for k in range(int(math.ceil(seconds / seg)) + 1):
        ch = chords[k % len(chords)]
        center = k * seg
        env = np.clip(1 - np.abs(t - center) / seg, 0, 1) ** 1.5
        mask = env > 0
        tone = np.zeros(mask.sum(), np.float32)
        for i, f in enumerate(ch):
            detune = 1 + 0.002 * (i - 1.5)
            tone += (0.22 / (1 + i * 0.4)) * np.sin(2 * np.pi * f * detune * t[mask] + rng.uniform(0, 6.28))
        out[mask] += tone * env[mask]
    noise = rng.normal(0, 1, n).astype(np.float32)
    k = int(sr * 0.004)
    noise = np.convolve(noise, np.ones(k) / k, mode="same")
    noise = np.convolve(noise, np.ones(k) / k, mode="same")
    out += 0.05 * noise * (0.6 + 0.4 * np.sin(2 * np.pi * t / 23.0))
    out *= 0.85 + 0.15 * np.sin(2 * np.pi * t / 9.0)
    fade = int(3 * sr)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade:] *= np.linspace(1, 0, fade)
    out /= max(1e-6, np.abs(out).max()) / 0.5
    stereo = np.stack([out, np.roll(out, int(0.011 * sr))], 1)
    pcm = (stereo * 32767).astype(np.int16)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return path


def mix_audio(project: Project, narration: Path, total: float, out: Path) -> dict:
    a = project.settings["audio"]
    music = project.path("audio", "music_bed.wav")
    if a["music"] == "procedural":
        music_bed(music, total)
    else:
        music = Path(a["music"])
        if not music.is_absolute():
            music = project.dir.parent.parent / music
        if not music.exists():
            raise PipelineError(f"music file not found: {music}")
    raw = out.with_name(out.stem + "_raw.wav")
    fc = (f"[0:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad=whole_dur={total:.3f},asplit=2[nar][sc];"
          f"[1:a]aresample=48000,aloop=loop=-1:size=2e9,atrim=0:{total:.3f},volume={a['music_db']}dB[mus];"
          f"[mus][sc]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=600[duck];"
          f"[nar][duck]amix=inputs=2:normalize=0:duration=first[m]")
    run(["ffmpeg", "-y", "-v", "error", "-i", str(narration), "-i", str(music), "-filter_complex", fc,
         "-map", "[m]", "-t", f"{total:.3f}", str(raw)])
    meas = run(["ffmpeg", "-hide_banner", "-i", str(raw), "-af",
                f"loudnorm=I={a['target_lufs']}:TP={a['true_peak']}:LRA=11:print_format=json", "-f", "null", "-"])
    m = json.loads(meas.stderr[meas.stderr.rindex("{"):meas.stderr.rindex("}") + 1])
    run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-af",
         f"loudnorm=I={a['target_lufs']}:TP={a['true_peak']}:LRA=11:measured_I={m['input_i']}:"
         f"measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:"
         f"offset={m['target_offset']}:linear=true,aresample=48000", "-t", f"{total:.3f}", str(out)])
    raw.unlink(missing_ok=True)
    return m


# ------------------------------------------------------------------ long form
def plan_segments(project: Project, timing: dict, animatic: bool) -> list[dict]:
    sb = am.storyboard(project)
    style = sb["style_bible"]
    fps = project.settings["video"]["long_form"]["fps"]
    units = {u["id"]: u for u in timing["units"]}
    cuts = sb["cuts"]
    missing = []
    segs = []
    for i, c in enumerate(cuts):
        start = 0.0 if i == 0 else units[c["id"]]["start"]
        end = units[cuts[i + 1]["id"]]["start"] if i + 1 < len(cuts) else timing["duration"]
        frames = round(end * fps) - round(start * fps)
        src = am.cut_asset(project, c, style)
        kind = c["asset_type"]
        placeholder = False
        if src is None:
            if c["asset_type"] in ("diagram", "title"):
                raise PipelineError(f"{c['id']}: diagram not rendered — run `produce` (assets step) first")
            missing.append(c["id"])
            if not animatic:
                continue
            src, kind, placeholder = placeholder_card(project, c), "image", True
        motion = "static" if placeholder else c["camera_motion"]
        first_in_sec = i == 0 or cuts[i - 1]["section"] != c["section"]
        last_in_sec = i + 1 == len(cuts) or cuts[i + 1]["section"] != c["section"]
        segs.append({"cut": c["id"], "src": src, "kind": kind, "motion": motion, "frames": frames,
                     "start": start, "end": end, "placeholder": placeholder,
                     "fade_in": first_in_sec and i > 0, "fade_out": last_in_sec and i + 1 < len(cuts)})
    if missing and not animatic:
        raise PipelineError(f"{len(missing)} cuts have no ready asset: {', '.join(missing)}. "
                            "Generate/import them (`assets requests` / `assets import`) or use --animatic.")
    return segs


def build_segments(project: Project, segs: list[dict], vcfg: dict, seg_dir: Path) -> list[Path]:
    paths = []
    for s in segs:
        st = s["src"].stat()
        key = sha(str(s["src"]), st.st_size, st.st_mtime, s["kind"], s["motion"], s["frames"],
                  s["fade_in"], s["fade_out"], vcfg["width"], vcfg["height"])
        out = seg_dir / f"{s['cut']}_{key}.mp4"
        if not out.exists():
            for old in seg_dir.glob(f"{s['cut']}_*.mp4"):
                old.unlink()
            render_segment(s["src"], s["kind"], s["motion"], s["frames"], out, w=vcfg["width"], h=vcfg["height"],
                           fps=vcfg["fps"], fade_in=s["fade_in"], fade_out=s["fade_out"])
        paths.append(out)
    return paths


def concat(paths: list[Path], out: Path) -> Path:
    lst = out.with_suffix(".txt")
    lst.write_text("".join(f"file '{p.resolve()}'\n" for p in paths))
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)])
    lst.unlink()
    return out


def edit_long(project: Project, animatic: bool = False) -> dict:
    vcfg = project.settings["video"]["long_form"]
    timing = read_json(project.path("audio", "timing.json"))
    if not timing:
        raise PipelineError("audio/timing.json missing — run the voice step first")
    script = read_json(project.path("scripts", "script.json"))
    suffix = "_ANIMATIC" if animatic else ""
    out = project.path("output", f"{project.slug}_long{suffix}.mp4")
    with project.stage("edit", {"animatic": animatic}) as rec:
        segs = plan_segments(project, timing, animatic)
        seg_paths = build_segments(project, segs, vcfg, project.path("output", "segments"))
        ec = end_card(project, script["title"])
        ec_frames = int(END_CARD_SECONDS * vcfg["fps"])
        ec_seg = render_segment(ec, "image", "static", ec_frames, project.path("output", "segments", "end_card.mp4"),
                                w=vcfg["width"], h=vcfg["height"], fps=vcfg["fps"], fade_in=True, fade_out=True)
        video_only = concat(seg_paths + [ec_seg], project.path("output", "video_only.mp4"))
        total = timing["duration"] + END_CARD_SECONDS

        sub = project.settings["subtitles"]
        events = subtitle_events(timing, sub["max_chars_per_line"], sub["max_lines"])
        srt = project.path("subtitles", f"{project.slug}_en.srt")
        ass = project.path("subtitles", f"{project.slug}_burn.ass")
        write_srt(events, srt)
        write_ass(events, ass, w=vcfg["width"], h=vcfg["height"], font=sub["font"], size=sub["long_font_size"],
                  margin_v=70)

        mix = project.path("audio", "mix_long.wav")
        loud = mix_audio(project, project.path("audio", "narration.wav"), total, mix)

        run(["ffmpeg", "-y", "-v", "error", "-i", str(video_only), "-i", str(mix),
             "-vf", f"ass={ass}", "-map", "0:v", "-map", "1:a", "-c:v", "libx264",
             "-preset", vcfg.get("preset", project.settings["video"]["preset"]), "-crf",
             str(project.settings["video"]["crf"]), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
             "-movflags", "+faststart", "-t", f"{total:.3f}", str(out)])
        video_only.unlink(missing_ok=True)
        placeholders = [s["cut"] for s in segs if s["placeholder"]]
        manifest = {"output": str(out.relative_to(project.dir)), "animatic": animatic, "duration": total,
                    "placeholder_cuts": placeholders, "subtitles_srt": str(srt.relative_to(project.dir)),
                    "loudness_input": {k: loud[k] for k in ("input_i", "input_tp")},
                    "segments": [{k: (str(v) if isinstance(v, Path) else v) for k, v in s.items()} for s in segs]}
        write_json(project.path("output", f"edit_manifest{suffix}.json"), manifest)
        rec["outputs"] += [manifest["output"], manifest["subtitles_srt"]]
        if placeholders:
            rec["notes"].append(f"ANIMATIC: {len(placeholders)} placeholder cuts — not publishable")
    return manifest
