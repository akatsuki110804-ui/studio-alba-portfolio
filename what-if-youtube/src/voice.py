"""STEP 6: narration — VOICEVOX (Japanese) or Kokoro (English), both local and free.

Each sentence is synthesised separately and cached by hash(text, engine settings). Editing one line of the
script only re-synthesises the sentences that changed. Because every sentence has its own exact duration,
subtitle timing comes straight from the audio — no forced alignment needed.

`voice.readings` maps display spellings to TTS-only readings (e.g. 氷床 → ひょうしょう) so subtitles keep
normal notation. For VOICEVOX the kana reading of every sentence is saved for human review.
"""
from __future__ import annotations

import io
import re
import wave
from pathlib import Path

import numpy as np

from . import cost_tracker
from .common import PipelineError, Project, expand, read_json, sha, write_json

SR = 24000
_engines: dict = {}


def _kokoro(v: dict):
    if "kokoro" not in _engines:
        try:
            from kokoro_onnx import Kokoro
        except ImportError as e:
            raise PipelineError("kokoro-onnx is not installed (pip install kokoro-onnx soundfile)") from e
        mp, vp = expand(v["model_path"]), expand(v["voices_path"])
        if not mp.exists() or not vp.exists():
            raise PipelineError(f"Kokoro model files missing: {mp} / {vp}. See README › Setup.")
        _engines["kokoro"] = Kokoro(str(mp), str(vp))
    return _engines["kokoro"]


def _voicevox(v: dict):
    if "voicevox" not in _engines:
        try:
            from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile
        except ImportError as e:
            raise PipelineError("voicevox_core is not installed — see README › Setup (VOICEVOX)") from e
        root = expand(v["root"])
        paths = {k: root / v[k] for k in ("onnxruntime", "dict", "vvm")}
        missing = [str(p) for p in paths.values() if not p.exists()]
        if missing:
            raise PipelineError(f"VOICEVOX files missing: {missing}. See README › Setup.")
        syn = Synthesizer(Onnxruntime.load_once(filename=str(paths["onnxruntime"])), OpenJtalk(str(paths["dict"])))
        with VoiceModelFile.open(str(paths["vvm"])) as m:
            syn.load_voice_model(m)
        _engines["voicevox"] = syn
    return _engines["voicevox"]


def engine_settings(project: Project) -> tuple[str, dict]:
    v = project.settings["voice"]
    name = v["engine"]
    if name not in ("voicevox", "kokoro"):
        raise PipelineError(f"unknown voice.engine '{name}'")
    return name, v[name]


def tts_text(project: Project, text: str) -> str:
    for spelled, reading in (project.settings["voice"].get("readings") or {}).items():
        text = text.replace(spelled, reading)
    return text


def split_sentences(text: str) -> list[str]:
    text = text.strip()
    if re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", text):
        parts = re.split(r"(?<=[。！？!?])", text)
    else:
        parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])", text)
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


def kana_reading(project: Project, text: str) -> str:
    """VOICEVOX's katakana reading of a sentence ('' for other engines) — for pronunciation review."""
    name, v = engine_settings(project)
    if name != "voicevox":
        return ""
    q = _voicevox(v).create_audio_query(tts_text(project, text), int(v["style_id"]))
    return "".join("".join(m.text for m in ap.moras) + ("、" if ap.pause_mora else "") for ap in q.accent_phrases)


def _synthesize(project: Project, text: str) -> np.ndarray:
    name, v = engine_settings(project)
    spoken = tts_text(project, text)
    if name == "kokoro":
        samples, sr = _kokoro(v).create(spoken, voice=v["voice"], speed=float(v["speed"]), lang=v["lang"])
        if sr != SR:
            raise PipelineError(f"unexpected Kokoro sample rate {sr}")
        return np.asarray(samples, dtype=np.float32)
    syn = _voicevox(v)
    sid = int(v["style_id"])
    q = syn.create_audio_query(spoken, sid)
    q.speed_scale = float(v.get("speed", 1.0))
    q.pitch_scale = float(v.get("pitch", 0.0))
    q.intonation_scale = float(v.get("intonation", 1.0))
    q.output_sampling_rate = SR
    q.pre_phoneme_length = q.post_phoneme_length = 0.05
    with wave.open(io.BytesIO(syn.synthesis(q, sid)), "rb") as w:
        if w.getframerate() != SR:
            raise PipelineError(f"unexpected VOICEVOX sample rate {w.getframerate()}")
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32767
        return x if w.getnchannels() == 1 else x.reshape(-1, w.getnchannels()).mean(1)


def synth_sentence(project: Project, text: str, cache_dir: Path) -> tuple[Path, float, bool]:
    """Return (wav path, seconds, freshly_generated)."""
    name, v = engine_settings(project)
    key = sha(tts_text(project, text), name, v)
    out = cache_dir / f"{key}.wav"
    if out.exists():
        return out, len(_read_wav(out)) / SR, False
    samples = _trim_silence(_synthesize(project, text))
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
            sents.append({"text": s, "start": round(t, 3), "end": round(t + dur, 3), "kana": kana_reading(project, s)})
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
            name, v = engine_settings(project)
            cost_tracker.record(project, stage="voice", item="long-form narration", provider=f"{name} (local)",
                                model=v.get("credit") or v.get("voice", ""), units=timing["generated"],
                                cost_jpy=0, kind="free", note="local CPU synthesis")
        write_readings(project, timing, project.path("audio", "readings.md"))
    return timing


def write_readings(project: Project, timing: dict, out: Path) -> None:
    """Sentence → kana list so a person can spot misreadings without listening to the whole track."""
    if not any(snt.get("kana") for u in timing["units"] for snt in u["sentences"]):
        return
    lines = ["# 読み確認リスト（VOICEVOX のかな読み）", "",
             "誤読があれば config/settings.yaml の voice.readings に「表記: よみ」を追加して再生成してください。", "",
             "| cut | 文 | 読み |", "|---|---|---|"]
    for u in timing["units"]:
        for snt in u["sentences"]:
            lines.append(f"| {u['id']} | {snt['text']} | {snt.get('kana', '')} |")
    out.write_text("\n".join(lines) + "\n")
