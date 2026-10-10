"""Shared helpers: paths, config, project state, logging, ffprobe."""
from __future__ import annotations

import copy
import datetime as _dt
import hashlib
import json
import os
import re
import subprocess
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
PROJECTS_DIR = ROOT / "projects"
LOG_DIR = ROOT / "logs"

STAGES = [
    "plan", "research", "script", "storyboard",       # `plan` command
    "assets", "voice", "edit", "shorts", "thumbnails",  # `produce` command
    "validate",                                        # `validate` command
]


class PipelineError(Exception):
    """A stage failed in a way the user must fix (missing input, bad data, tool error)."""


class NeedsInput(PipelineError):
    """A stage is waiting for a human/agent-supplied file (manual LLM mode, missing assets)."""


class BudgetExceeded(PipelineError):
    """Projected spend would pass a configured limit; the user must confirm."""


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def slugify(text: str) -> str:
    text = re.sub(r"^what if\s+", "", text.strip().lower())
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return text[:48] or "project"


def sha(*parts: Any) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(json.dumps(p, sort_keys=True, ensure_ascii=False).encode())
    return h.hexdigest()[:16]


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_settings(project_dir: Path | None = None) -> dict:
    settings = yaml.safe_load((CONFIG_DIR / "settings.yaml").read_text())
    if project_dir and (project_dir / "project.yaml").exists():
        proj = yaml.safe_load((project_dir / "project.yaml").read_text()) or {}
        settings = _deep_merge(settings, proj.get("overrides", {}))
    return settings


def expand(p: str) -> Path:
    """Expand ~ and resolve relative paths against the what-if-youtube/ root."""
    path = Path(os.path.expanduser(p))
    return path if path.is_absolute() else ROOT / path


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text())


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


class Project:
    """A video project folder: projects/<slug>/..."""

    SUBDIRS = ["research", "plan", "scripts", "storyboard", "assets/images", "assets/video",
               "assets/diagrams", "audio", "subtitles", "previews", "output", "reports",
               "shorts", "thumbnails", "prompts"]

    def __init__(self, slug: str):
        self.slug = slug
        self.dir = PROJECTS_DIR / slug
        if not self.dir.exists():
            raise PipelineError(f"Project '{slug}' not found at {self.dir}. Run `plan --topic ...` first.")
        self.settings = load_settings(self.dir)

    @classmethod
    def create(cls, topic: str, slug: str | None = None) -> "Project":
        slug = slug or slugify(topic)
        d = PROJECTS_DIR / slug
        for sub in cls.SUBDIRS:
            (d / sub).mkdir(parents=True, exist_ok=True)
        meta = d / "project.yaml"
        if not meta.exists():
            meta.write_text(yaml.safe_dump({"topic": topic, "slug": slug, "created": now_iso(),
                                            "overrides": {}}, sort_keys=False))
        return cls(slug)

    @property
    def meta(self) -> dict:
        return yaml.safe_load((self.dir / "project.yaml").read_text())

    def path(self, *parts: str) -> Path:
        return self.dir.joinpath(*parts)

    # ---- state (resume support) ----
    @property
    def state_path(self) -> Path:
        return self.path("state.json")

    def state(self) -> dict:
        return read_json(self.state_path, {"stages": {}})

    def set_stage(self, stage: str, **fields: Any) -> None:
        st = self.state()
        entry = st["stages"].setdefault(stage, {})
        entry.update(fields)
        write_json(self.state_path, st)

    def stage_done(self, stage: str, fingerprint: str | None = None) -> bool:
        entry = self.state()["stages"].get(stage, {})
        if entry.get("status") != "done":
            return False
        return fingerprint is None or entry.get("fingerprint") == fingerprint

    # ---- logging ----
    def log(self, stage: str, event: str, **data: Any) -> None:
        rec = {"ts": now_iso(), "project": self.slug, "stage": stage, "event": event, **data}
        line = json.dumps(rec, ensure_ascii=False)
        for p in (self.path("reports", "pipeline_log.jsonl"), LOG_DIR / "pipeline.jsonl"):
            p.parent.mkdir(parents=True, exist_ok=True)
            with p.open("a") as f:
                f.write(line + "\n")

    @contextmanager
    def stage(self, name: str, inputs: dict | None = None, fingerprint: str | None = None):
        """Records start/end/outcome of a stage. Errors are logged and re-raised."""
        started = now_iso()
        self.set_stage(name, status="running", started=started, inputs=inputs or {})
        self.log(name, "start", inputs=inputs or {})
        record: dict = {"outputs": [], "retries": 0, "cost_jpy": 0.0, "notes": []}
        try:
            yield record
        except NeedsInput as e:
            self.set_stage(name, status="waiting", finished=now_iso(), error=str(e))
            self.log(name, "waiting", error=str(e))
            raise
        except Exception as e:  # noqa: BLE001 - we log then re-raise everything
            self.set_stage(name, status="failed", finished=now_iso(), error=f"{type(e).__name__}: {e}")
            self.log(name, "failed", error=f"{type(e).__name__}: {e}")
            raise
        else:
            self.set_stage(name, status="done", finished=now_iso(), error=None,
                           fingerprint=fingerprint, **record)
            self.log(name, "done", **record)


def run(cmd: list[str], *, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(cmd, capture_output=capture, text=True)
    if check and proc.returncode != 0:
        tail = (proc.stderr or "")[-2500:]
        raise PipelineError(f"Command failed ({proc.returncode}): {' '.join(cmd[:6])} ...\n{tail}")
    return proc


def ffprobe(path: Path) -> dict:
    out = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    return json.loads(out.stdout)


def media_duration(path: Path) -> float:
    return float(ffprobe(path)["format"]["duration"])
