"""Cost ledger and budget guard.

Every paid or free generation is written to two CSV ledgers:
  projects/<slug>/reports/cost_ledger.csv   (per video)
  logs/cost_ledger.csv                       (all projects, used for the monthly limit)

`kind` is one of:
  actual    – the provider reported the charge (e.g. Higgsfield credits from get_cost / transactions)
  estimate  – computed from a price table; the real charge was not available
  free      – local processing (Kokoro TTS, FFmpeg, Pillow diagrams)
"""
from __future__ import annotations

import csv
import datetime as _dt
from pathlib import Path

from .common import LOG_DIR, BudgetExceeded, Project, now_iso

FIELDS = ["ts", "project", "stage", "item", "provider", "model", "units", "credits",
          "cost_jpy", "kind", "note"]


def _append(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with path.open("a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in FIELDS})


def _rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open() as f:
        return list(csv.DictReader(f))


def credits_to_jpy(project: Project, credits: float) -> float:
    return round(credits * float(project.settings["budget"]["credit_to_jpy"]), 2)


def record(project: Project, *, stage: str, item: str, provider: str, model: str = "",
           units: float = 1, credits: float = 0.0, cost_jpy: float | None = None,
           kind: str = "estimate", note: str = "") -> dict:
    if cost_jpy is None:
        cost_jpy = credits_to_jpy(project, credits)
    row = {"ts": now_iso(), "project": project.slug, "stage": stage, "item": item,
           "provider": provider, "model": model, "units": units, "credits": credits,
           "cost_jpy": cost_jpy, "kind": kind, "note": note}
    _append(project.path("reports", "cost_ledger.csv"), row)
    _append(LOG_DIR / "cost_ledger.csv", row)
    return row


def project_rows(project: Project) -> list[dict]:
    return _rows(project.path("reports", "cost_ledger.csv"))


def project_total(project: Project, stage: str | None = None) -> float:
    return round(sum(float(r["cost_jpy"] or 0) for r in project_rows(project)
                     if stage is None or r["stage"] == stage), 2)


def month_total(month: str | None = None) -> float:
    month = month or _dt.date.today().strftime("%Y-%m")
    return round(sum(float(r["cost_jpy"] or 0) for r in _rows(LOG_DIR / "cost_ledger.csv")
                     if r["ts"].startswith(month)), 2)


def check_budget(project: Project, stage: str, projected_jpy: float, *, confirmed: bool = False) -> None:
    """Raise BudgetExceeded when the projected spend would cross a limit (or the confirm threshold)."""
    b = project.settings["budget"]
    limits = {
        "stage": (project_total(project, stage), float(b["per_stage_limit_jpy"].get(stage, b["per_video_limit_jpy"]))),
        "video": (project_total(project), float(b["per_video_limit_jpy"])),
        "month": (month_total(), float(b["monthly_limit_jpy"])),
    }
    hard, soft = [], []
    for scope, (spent, limit) in limits.items():
        after = spent + projected_jpy
        if after > limit:
            hard.append(f"{scope}: ¥{spent:.0f} spent + ¥{projected_jpy:.0f} projected > limit ¥{limit:.0f}")
        elif after > limit * float(b["confirm_threshold"]):
            soft.append(f"{scope}: would reach ¥{after:.0f} of ¥{limit:.0f} "
                        f"(over {int(float(b['confirm_threshold']) * 100)}% — re-run with --confirm-spend)")
    if hard or (soft and not confirmed):
        raise BudgetExceeded("Budget check failed for stage '%s':\n  - %s" % (stage, "\n  - ".join(hard + soft)))


def summary(project: Project) -> dict:
    rows = project_rows(project)
    by_stage: dict[str, dict] = {}
    for r in rows:
        s = by_stage.setdefault(r["stage"], {"items": 0, "credits": 0.0, "cost_jpy": 0.0, "kinds": set()})
        s["items"] += 1
        s["credits"] += float(r["credits"] or 0)
        s["cost_jpy"] += float(r["cost_jpy"] or 0)
        s["kinds"].add(r["kind"])
    for s in by_stage.values():
        s["kinds"] = sorted(s["kinds"])
        s["credits"] = round(s["credits"], 2)
        s["cost_jpy"] = round(s["cost_jpy"], 2)
    return {"by_stage": by_stage, "total_jpy": project_total(project),
            "total_credits": round(sum(float(r["credits"] or 0) for r in rows), 2),
            "month_total_jpy": month_total(), "rows": len(rows)}
