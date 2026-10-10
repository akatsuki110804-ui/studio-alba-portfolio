"""LLM stage runner with two providers.

manual     Writes prompts/<stage>.prompt.md and expects the answer at the stage's output path.
           Claude Code (or a person) writes that JSON file; the next run validates it and moves on.
anthropic  Calls the Claude API through the official `anthropic` SDK. Credentials come from the
           environment (ANTHROPIC_API_KEY / `ant auth login`). Never hard-code a key.

Either way the output is validated against a JSON schema before a stage is marked done,
so a broken or partial answer never flows into later stages.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import jsonschema
import yaml

from . import cost_tracker
from .common import CONFIG_DIR, NeedsInput, PipelineError, Project, read_json, write_json
from .schemas import SCHEMAS


def _prompts() -> dict:
    return yaml.safe_load((CONFIG_DIR / "prompts.yaml").read_text())


def render_prompt(stage: str, **ctx) -> tuple[str, str]:
    p = _prompts()
    ctx = {k: (json.dumps(v, ensure_ascii=False, indent=1) if not isinstance(v, str) else v)
           for k, v in ctx.items()}
    return p["system"], p[stage].format(**ctx)


def validate(stage: str, data: dict) -> None:
    try:
        jsonschema.validate(data, SCHEMAS[stage])
    except jsonschema.ValidationError as e:
        path = "/".join(str(x) for x in e.absolute_path)
        raise PipelineError(f"{stage} output failed validation at '{path}': {e.message}") from e


def _extract_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise PipelineError("LLM response contained no JSON object")
    return json.loads(m.group(0))


def _call_anthropic(project: Project, stage: str, system: str, prompt: str) -> dict:
    try:
        import anthropic  # optional dependency
    except ImportError as e:
        raise PipelineError("llm.provider is 'anthropic' but the `anthropic` package is not installed "
                            "(pip install anthropic)") from e
    cfg = project.settings["llm"]
    client = anthropic.Anthropic()
    tools = []
    if stage == "research":
        tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 12}]
    # Server-side refusal fallback is enabled by default for this model family.
    with client.beta.messages.stream(
        model=cfg["model"], max_tokens=int(cfg["max_tokens"]), system=system,
        output_config={"effort": cfg.get("effort", "high")},
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        tools=tools or anthropic.NOT_GIVEN,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        msg = stream.get_final_message()
    if msg.stop_reason == "refusal":
        raise PipelineError(f"Claude declined the {stage} request: {getattr(msg, 'stop_details', None)}")
    if msg.stop_reason == "max_tokens":
        raise PipelineError(f"{stage}: response hit max_tokens; raise llm.max_tokens")
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    u = msg.usage
    usd = (u.input_tokens * 4 + u.output_tokens * 20) / 1_000_000  # Opus 5.5 list price; estimate
    cost_tracker.record(project, stage="llm", item=stage, provider="anthropic", model=cfg["model"],
                        units=u.input_tokens + u.output_tokens,
                        cost_jpy=round(usd * float(project.settings["budget"]["usd_to_jpy"]), 2),
                        kind="estimate", note="token usage × list price")
    return _extract_json(text)


def run_stage(project: Project, stage: str, out_path: Path, *, force: bool = False, **ctx) -> dict:
    """Return validated JSON for an LLM stage, generating or waiting for it as configured."""
    if out_path.exists() and not force:
        data = read_json(out_path)
        validate(stage, data)
        return data

    ctx.setdefault("language", project.settings["channel"].get("language", "en"))
    system, prompt = render_prompt(stage, **ctx)
    prompt_file = project.path("prompts", f"{stage}.prompt.md")
    prompt_file.parent.mkdir(parents=True, exist_ok=True)
    prompt_file.write_text(f"<!-- system -->\n{system}\n\n<!-- user -->\n{prompt}\n")

    provider = project.settings["llm"]["provider"]
    if provider == "anthropic":
        data = _call_anthropic(project, stage, system, prompt)
        validate(stage, data)
        write_json(out_path, data)
        return data

    raise NeedsInput(
        f"[{stage}] manual LLM mode: answer the prompt in {prompt_file.relative_to(project.dir.parent.parent)} "
        f"and save the JSON to {out_path.relative_to(project.dir.parent.parent)}, then re-run the command. "
        f"(Set llm.provider: anthropic in config to call the Claude API instead.)")
