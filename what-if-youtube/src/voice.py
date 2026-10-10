"""STEP 6: English narration with local Kokoro TTS.

Each sentence is synthesised separately and cached by hash(text, voice, speed). Editing one line of the
script only re-synthesises the sentences that changed. Because every sentence has its own exact duration,
subtitle timing comes straight from the audio — no forced alignment needed.
"""
from __future__ import annotations

import re
import wave
from pathlib import Path

import numpy as np

from . import cost_tracker
from .common import PipelineError, Project, expand, read_json, sha, write_json

SR = 24000
_engine = None


def _kokoro(settings: dict):
    global _engine
    if _engine is None:
        try:
            from kokoro_onnx import Kokoro
        except ImportError as e:
            raise PipelineError("kokoro-onnx is not installed (pip install kokoro-onnx soundfile)") from e
        v = settings["voice"]
        mp, vp = expand(v["model_path"]), expand(v["voices_path"])
        if not mp.exists() or not vp.exists():
            raise PipelineError(f"Kokoro model files missing: {mp} / {vp}. See README › Setup.")
        _engine = Kokoro(str(mp), str(vp))
    return _engine


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])", text.strip())
    return [p.strip() for p in parts if p.strip()]


def _write_wav(path: Path, samples: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def _read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32767


def synth_sentence(project: Project, text: str, cache_dir: Path) -> tuple[Path, float, bool]:
    """Return (wav path, seconds, freshly_generated)."""
    v = project.settings["voice"]
    key = sha(text, v["voice"], v["speed"], v["lang"], "kokoro-v1.0")
    out = cache_dir / f"{key}.wav"
    if out.exists():
        return out, len(_read_wav(out)) / SR, False
    samples, sr = _kokoro(project.settings).create(text, voice=v["voice"], speed=float(v["speed"]), lang=v["lang"])
    if sr != SR:
        raise PipelineError(f"unexpected Kokoro sample rate {sr}")
    samples = _trim_silence(np.asarray(samples, dtype=np.float32))
    if len(samples) < SR * 0.2:
        raise PipelineError(f"TTS produced almost no audio for: {text!r}")
    _write_wav(out, samples)
    return out, len(samples) / SR, True


def _trim_silence(x: np.ndarray, thresh: float = 0.01, pad: float = 0.04) -> np.ndarray:
    idx = np.where(np.abs(x) > thresh)[0]
    if len(idx) == 0:
        return x
    p = int(pad * SR)
    return x[max(0, idx[0] - p): min(len(x), idx[-1] + p)]


def build_track(project: Project, units: list[dict], out_wav: Path, timing_json: Path,
                lead_in: float = 0.6) -> dict:
    """units: [{id, text}] in order. Writes one narration WAV + timing for every sentence and unit."""
    v = project.settings["voice"]
    gap, tail = float(v["sentence_gap"]), float(v["cut_tail"])
    cache = project.path("audio", "cache")
    pieces: list[np.ndarray] = [np.zeros(int(lead_in * SR), np.float32)]
    t = lead_in
    timing = {"units": [], "sample_rate": SR}
    generated = reused = 0
    for u in units:
        start = t
        sents = []
        for s in split_sentences(u["text"]):
            wav, dur, fresh = synth_sentence(project, s, cache)
            generated += fresh
            reused += not fresh
            pieces.append(_read_wav(wav))
            sents.append({"text": s, "start": round(t, 3), "end": round(t + dur, 3)})
            t += dur
            pieces.append(np.zeros(int(gap * SR), np.float32))
            t += gap
        pieces.append(np.zeros(int(tail * SR), np.float32))
        t += tail
        timing["units"].append({"id": u["id"], "start": round(start, 3), "end": round(t, 3), "sentences": sents})
    track = np.concatenate(pieces)
    timing["duration"] = round(len(track) / SR, 3)
    _write_wav(out_wav, track)
    write_json(timing_json, timing)
    timing["generated"], timing["reused"] = generated, reused
    return timing


def narrate_long(project: Project) -> dict:
    sb = read_json(project.path("storyboard", "storyboard.json"))
    units = [{"id": c["id"], "text": c["narration"]} for c in sb["cuts"]]
    fp = sha(units, project.settings["voice"])
    if project.stage_done("voice", fp) and project.path("audio", "narration.wav").exists():
        return read_json(project.path("audio", "timing.json"))
    with project.stage("voice", {"cuts": len(units)}, fingerprint=fp) as rec:
        timing = build_track(project, units, project.path("audio", "narration.wav"), project.path("audio", "timing.json"))
        rec["outputs"] += ["audio/narration.wav", "audio/timing.json"]
        rec["notes"].append(f"{timing['duration']:.1f}s narration; sentences generated={timing['generated']} "
                            f"reused from cache={timing['reused']}")
        if timing["generated"]:
            cost_tracker.record(project, stage="voice", item="long-form narration", provider="kokoro (local)",
                                model="kokoro-v1.0 " + project.settings["voice"]["voice"],
                                units=timing["generated"], cost_jpy=0, kind="free", note="local CPU synthesis")
    return timing
