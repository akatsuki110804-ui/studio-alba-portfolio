"""Fast tests (no TTS, no long renders). Run: python -m pytest tests -q"""
from __future__ import annotations

import json
import shutil

import pytest

from src import asset_manager as am
from src import cost_tracker, editor, llm, motion
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


def test_all_motion_specs_render_and_move():
    sb = json.loads((SAMPLE / "storyboard/storyboard.json").read_text())
    for c in sb["cuts"]:
        if c["asset_type"] == "motion":
            a = motion.still(c["diagram"], 0.5, 8.0)
            b = motion.still(c["diagram"], 5.0, 8.0)
            assert a.size == (1920, 1080)
            assert a.tobytes() != b.tobytes(), f"{c['id']} ({c['diagram']['type']}) does not move"


def test_no_still_images_in_storyboard():
    sb = json.loads((SAMPLE / "storyboard/storyboard.json").read_text())
    assert {c["asset_type"] for c in sb["cuts"]} <= {"video", "motion"}


def test_motion_clip_has_exact_frame_count(tmp_path):
    out = motion.render_clip({"type": "bar_compare", "params": {"title": "t", "bars": [{"label": "a", "value": 1}]}},
                             15, tmp_path / "m.mp4")
    from src.common import ffprobe
    v = [s for s in ffprobe(out)["streams"] if s["codec_type"] == "video"][0]
    assert int(v["nb_frames"]) == 15


def test_japanese_subtitles_and_sentences():
    from src.voice import split_sentences
    s = "月が消えると、この小さな回転がまっすぐになるだけで、太陽をめぐる地球の道筋は、ほとんど変わらないのです。"
    assert split_sentences("月が、消えました。爆発も、閃光もありません。") == ["月が、消えました。", "爆発も、閃光もありません。"]
    for chunk in editor.chunk_sentence(s, 52):
        lines = editor.wrap_lines(chunk, 26)
        assert len(lines) <= 2 and all(len(x) <= 26 for x in lines)
        assert all(x[0] not in editor.NO_LINE_START for x in lines)


def test_tts_readings_apply_only_to_speech(tmp_project):
    from src.voice import tts_text
    assert tts_text(tmp_project, "氷床と歳差運動") == "ひょうしょうとさいさうんどう"


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
    pending = [s for s in segs if s["placeholder"]]
    assert pending and all(s["kind"] == "motion" and s["spec"]["type"] == "pending" for s in pending)


def _clip(path):
    from src.common import run
    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=1",
         "-pix_fmt", "yuv420p", str(path)])
    return path


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
        am.import_asset(tmp_project, "T1", sq)
    ok = tmp_path / "wide.png"
    Image.new("RGB", (1920, 1080), (20, 30, 40)).save(ok)
    am.import_asset(tmp_project, "T1", ok, credits=0.25)
    assert "T1" in am.status(tmp_project)["ready"]
    assert cost_tracker.project_total(tmp_project, "images") == pytest.approx(0.25 * 7.4)


def test_video_import_and_stale_on_prompt_change(tmp_project, tmp_path):
    am.import_asset(tmp_project, "C02", _clip(tmp_path / "c.mp4"), credits=7.5)
    assert "C02" in am.status(tmp_project)["ready"]
    assert cost_tracker.project_total(tmp_project, "video_clips") == pytest.approx(7.5 * 7.4)
    sbp = tmp_project.path("storyboard", "storyboard.json")
    sb = json.loads(sbp.read_text())
    sb["cuts"][1]["prompt"] += ", rain"
    sbp.write_text(json.dumps(sb))
    assert "C02" in am.status(tmp_project)["stale"]


def test_short_ai_clip_is_slowed_to_fill_cut(tmp_path):
    from src.common import media_duration
    out = editor.render_segment(_clip(tmp_path / "c.mp4"), "video", "static", 45, tmp_path / "s.mp4",
                                w=640, h=360, fps=30, max_slowdown=1.6)
    assert media_duration(out) == pytest.approx(1.5, abs=0.05)


def test_budget_guard(tmp_project):
    with pytest.raises(BudgetExceeded):
        cost_tracker.check_budget(tmp_project, "images", 5000)
    cost_tracker.check_budget(tmp_project, "images", 100)  # well under every limit
