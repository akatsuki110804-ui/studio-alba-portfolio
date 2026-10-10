"""Fast tests (no TTS, no long renders). Run: python -m pytest tests -q"""
from __future__ import annotations

import json
import shutil

import pytest

from src import asset_manager as am
from src import cost_tracker, diagrams, editor, llm
from src.common import BudgetExceeded, NeedsInput, PipelineError, Project, PROJECTS_DIR
from src.schemas import SCHEMAS

SAMPLE = PROJECTS_DIR / "moon_disappeared"


@pytest.fixture
def tmp_project(tmp_path, monkeypatch):
    """A throwaway copy of the sample project's planning files."""
    monkeypatch.setattr("src.common.PROJECTS_DIR", tmp_path)
    monkeypatch.setattr("src.common.LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr("src.cost_tracker.LOG_DIR", tmp_path / "logs")
    p = Project.create("What If the Moon Suddenly Disappeared?", "moon_test")
    for rel in ["plan/plan.json", "research/research.json", "scripts/script.json",
                "storyboard/storyboard.json", "shorts/shorts.json", "thumbnails/thumbnails.json"]:
        (p.dir / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(SAMPLE / rel, p.dir / rel)
    return Project("moon_test")


@pytest.mark.parametrize("stage,rel", [("plan", "plan/plan.json"), ("research", "research/research.json"),
                                       ("script", "scripts/script.json"), ("storyboard", "storyboard/storyboard.json"),
                                       ("shorts", "shorts/shorts.json")])
def test_sample_outputs_match_schema(stage, rel):
    llm.validate(stage, json.loads((SAMPLE / rel).read_text()))


def test_schema_rejects_bad_claim_category():
    data = json.loads((SAMPLE / "research/research.json").read_text())
    data["claims"][0]["category"] = "rumour"
    with pytest.raises(PipelineError):
        llm.validate("research", data)


def test_manual_llm_mode_waits_for_input(tmp_project):
    (tmp_project.dir / "plan/plan.json").unlink()
    with pytest.raises(NeedsInput):
        llm.run_stage(tmp_project, "plan", tmp_project.path("plan", "plan.json"),
                      topic="x", min_seconds=360, max_seconds=480)
    assert (tmp_project.dir / "prompts/plan.prompt.md").exists()


def test_script_claims_exist_in_research():
    research = json.loads((SAMPLE / "research/research.json").read_text())
    ids = {c["id"] for c in research["claims"]}
    script = json.loads((SAMPLE / "scripts/script.json").read_text())
    used = {cid for s in script["sections"] for ln in s["lines"] for cid in ln["claim_ids"]}
    assert used <= ids
    src_ids = {s["id"] for s in research["sources"]}
    assert all(set(c["source_ids"]) <= src_ids for c in research["claims"])


def test_every_script_line_has_a_cut():
    script = json.loads((SAMPLE / "scripts/script.json").read_text())
    sb = json.loads((SAMPLE / "storyboard/storyboard.json").read_text())
    lines = {ln["id"] for s in script["sections"] for ln in s["lines"]}
    assert lines == {c["line_id"] for c in sb["cuts"]}


def test_all_diagram_specs_render(tmp_path):
    sb = json.loads((SAMPLE / "storyboard/storyboard.json").read_text())
    for c in sb["cuts"]:
        if c["diagram"]:
            out = diagrams.render(c["diagram"], tmp_path / f"{c['id']}.png")
            assert out.stat().st_size > 10_000


def test_subtitle_chunks_respect_limits():
    s = ("Remove the Moon, and the wobble slows down, and it can fall into rhythm with those tugs. "
         "In 1993, Jacques Laskar and his colleagues calculated that a moonless Earth's tilt could wander.")
    for chunk in editor.chunk_sentence(s, 84):
        lines = editor.wrap_lines(chunk, 42)
        assert len(lines) <= 2
        assert all(len(x) <= 48 for x in lines)


def test_missing_assets_block_final_edit(tmp_project):
    timing = {"duration": 10.0, "units": [{"id": c["id"], "start": i * 0.2, "end": i * 0.2 + 0.2, "sentences": []}
                                          for i, c in enumerate(am.storyboard(tmp_project)["cuts"])]}
    am.render_code_assets(tmp_project)
    with pytest.raises(PipelineError, match="no ready asset"):
        editor.plan_segments(tmp_project, timing, animatic=False)
    segs = editor.plan_segments(tmp_project, timing, animatic=True)
    assert any(s["placeholder"] for s in segs)


def test_retry_limit_marks_failed_final(tmp_project):
    limit = tmp_project.settings["assets"]["max_retries"] + 1
    for _ in range(limit):
        e = am.record_failure(tmp_project, "C02", "timeout")
    assert e["status"] == "failed_final"
    assert "C02" in am.status(tmp_project)["failed_final"]


def test_import_rejects_wrong_aspect(tmp_project, tmp_path):
    from PIL import Image
    sq = tmp_path / "square.png"
    Image.new("RGB", (1024, 1024)).save(sq)
    with pytest.raises(PipelineError, match="16:9"):
        am.import_asset(tmp_project, "C02", sq)
    ok = tmp_path / "wide.png"
    Image.new("RGB", (1920, 1080), (20, 30, 40)).save(ok)
    am.import_asset(tmp_project, "C02", ok, credits=0.25)
    assert "C02" in am.status(tmp_project)["ready"]
    assert cost_tracker.project_total(tmp_project, "images") == pytest.approx(0.25 * 7.4)


def test_changed_prompt_makes_asset_stale(tmp_project, tmp_path):
    from PIL import Image
    ok = tmp_path / "wide.png"
    Image.new("RGB", (1920, 1080)).save(ok)
    am.import_asset(tmp_project, "C02", ok, credits=0.25)
    sbp = tmp_project.path("storyboard", "storyboard.json")
    sb = json.loads(sbp.read_text())
    sb["cuts"][1]["prompt"] += ", rain"
    sbp.write_text(json.dumps(sb))
    assert "C02" in am.status(tmp_project)["stale"]


def test_budget_guard(tmp_project):
    with pytest.raises(BudgetExceeded):
        cost_tracker.check_budget(tmp_project, "images", 5000)
    cost_tracker.check_budget(tmp_project, "images", 100)  # well under every limit
