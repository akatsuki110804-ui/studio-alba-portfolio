"""What If Science — command line.

  python -m src.main plan     --topic "What If the Moon Suddenly Disappeared?" [--slug moon_disappeared]
  python -m src.main produce  --project moon_disappeared [--animatic] [--confirm-spend]
  python -m src.main validate --project moon_disappeared
  python -m src.main assets   requests|status|import|fail --project moon_disappeared ...
  python -m src.main status   --project moon_disappeared

Every stage records its state in projects/<slug>/state.json, so re-running a command skips work that is
already done (LLM outputs that exist, cached TTS sentences, rendered segments) and resumes where it stopped.
Exit codes: 0 ok · 2 error · 3 waiting for input (manual LLM answer or assets) · 4 budget confirmation needed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import asset_manager as am
from . import cost_tracker, editor, planning, quality_check, shorts, thumbnail, voice
from .common import BudgetExceeded, NeedsInput, PipelineError, Project


def cmd_plan(a) -> None:
    project = Project.create(a.topic, a.slug) if a.topic else Project(a.project)
    print(f"project: {project.dir}")
    force = set(a.force or [])
    planning.plan(project, "plan" in force)
    print("✓ plan")
    planning.research(project, "research" in force)
    print("✓ research  → research/sources.md")
    planning.script(project, "script" in force)
    print("✓ script    → scripts/script.md")
    planning.storyboard(project, "storyboard" in force)
    planning.write_storyboard_md(project)
    print("✓ storyboard + shorts design → storyboard/storyboard.md, shorts/shorts.json")


def cmd_produce(a) -> None:
    project = Project(a.project)
    with project.stage("assets", {"animatic": a.animatic}) as rec:
        drawn = am.render_code_assets(project)
        req = am.write_requests(project, confirmed=a.confirm_spend)
        rec["notes"].append(f"diagrams rendered={len(drawn)}; pending AI assets={req['count']} "
                            f"(≈{req['est_credits']} credits, ≈¥{req['est_jpy']})")
    print(f"✓ assets: {len(drawn)} diagrams drawn; {req['count']} AI assets pending "
          f"(≈{req['est_credits']} credits ≈ ¥{req['est_jpy']}) → assets/requests.json")
    if req["count"] and not a.animatic:
        raise NeedsInput("AI assets are still pending. Generate them from assets/requests.json and import with "
                         "`assets import`, or run `produce --animatic` for a labelled draft.")
    t = voice.narrate_long(project)
    print(f"✓ voice: {t['duration']:.1f}s narration")
    m = editor.edit_long(project, animatic=a.animatic)
    print(f"✓ edit: {m['output']} ({m['duration']:.1f}s){'  [ANIMATIC]' if m['placeholder_cuts'] else ''}")
    for r in shorts.make_shorts(project, animatic=a.animatic):
        print(f"✓ short {r['id']}: {r['output']} ({r['duration']:.1f}s)")
    for r in thumbnail.make_thumbnails(project):
        print(f"✓ thumbnail {r['id']}: {r['output']}{'' if r['publishable'] else '  [DRAFT]'}")


def cmd_validate(a) -> None:
    q = quality_check.validate(Project(a.project))
    print(f"QC: errors={q['errors']} warnings={q['warnings']} publishable={q['publishable']}")
    for r in q["checks"]:
        if not r["ok"]:
            print(f"  {'✗' if r['severity'] == 'error' else '!'} {r['check']}: {r['detail'][:140]}")
    print("→ reports/qc_report.md (a person must still watch the video before publishing)")


def cmd_assets(a) -> None:
    project = Project(a.project)
    if a.action == "requests":
        r = am.write_requests(project, confirmed=a.confirm_spend)
        print(json.dumps({k: r[k] for k in ("count", "est_credits", "est_jpy")}))
    elif a.action == "status":
        print(json.dumps(am.status(project), indent=1))
    elif a.action == "import":
        e = am.import_asset(project, a.id, Path(a.file), credits=a.credits, job_id=a.job_id or "",
                            kind="actual" if a.credits is not None else "estimate")
        print(f"✓ {a.id} → {e['path']}")
    elif a.action == "fail":
        e = am.record_failure(project, a.id, a.error or "unspecified", credits=a.credits or 0.0)
        print(f"{a.id}: attempts={e['attempts']} status={e['status']}")


def cmd_status(a) -> None:
    project = Project(a.project)
    for name, e in project.state()["stages"].items():
        print(f"{name:12s} {e.get('status', '?'):8s} {e.get('finished', '')}  {e.get('error') or ''}")
    print(json.dumps(cost_tracker.summary(project), indent=1, default=str))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m src.main", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--topic")
    p.add_argument("--slug")
    p.add_argument("--project", help="re-run planning for an existing project")
    p.add_argument("--force", nargs="*", choices=["plan", "research", "script", "storyboard"],
                   help="regenerate these stages even if their output exists")
    p = sub.add_parser("produce")
    p.add_argument("--project", required=True)
    p.add_argument("--animatic", action="store_true", help="render placeholders for missing AI shots")
    p.add_argument("--confirm-spend", action="store_true")
    p = sub.add_parser("validate")
    p.add_argument("--project", required=True)
    p = sub.add_parser("assets")
    p.add_argument("action", choices=["requests", "status", "import", "fail"])
    p.add_argument("--project", required=True)
    p.add_argument("--id")
    p.add_argument("--file")
    p.add_argument("--credits", type=float)
    p.add_argument("--job-id")
    p.add_argument("--error")
    p.add_argument("--confirm-spend", action="store_true")
    p = sub.add_parser("status")
    p.add_argument("--project", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "plan" and not (a.topic or a.project):
        ap.error("plan needs --topic (new project) or --project (existing)")
    try:
        {"plan": cmd_plan, "produce": cmd_produce, "validate": cmd_validate, "assets": cmd_assets,
         "status": cmd_status}[a.cmd](a)
    except BudgetExceeded as e:
        print(f"BUDGET: {e}", file=sys.stderr)
        return 4
    except NeedsInput as e:
        print(f"WAITING: {e}", file=sys.stderr)
        return 3
    except PipelineError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
