"""JSON schemas for every LLM-produced file. Kept permissive on extras, strict on what later stages read."""

_str = {"type": "string", "minLength": 1}
_strlist = {"type": "array", "items": {"type": "string"}}

PLAN = {
    "type": "object",
    "required": ["titles", "unique_angle", "overview_ja", "why_interesting", "hook", "structure",
                 "target_seconds", "estimated_cuts", "shorts_candidates", "claims_to_verify"],
    "properties": {
        "titles": {"type": "array", "items": _str, "minItems": 5, "maxItems": 5},
        "unique_angle": _str, "overview_ja": _str, "hook": _str,
        "why_interesting": _strlist,
        "structure": {"type": "array", "minItems": 3, "items": {
            "type": "object", "required": ["section", "goal", "approx_seconds"]}},
        "target_seconds": {"type": "number", "minimum": 60},
        "estimated_cuts": {"type": "integer", "minimum": 1},
        "shorts_candidates": {"type": "array", "minItems": 2},
        "claims_to_verify": {"type": "array", "minItems": 1, "items": _str},
    },
}

RESEARCH = {
    "type": "object",
    "required": ["assumptions", "sources", "claims", "open_questions", "research_status"],
    "properties": {
        "assumptions": _strlist,
        "research_status": {"enum": ["complete", "incomplete", "not_performed"]},
        "sources": {"type": "array", "items": {
            "type": "object", "required": ["id", "title", "url", "access_method"]}},
        "claims": {"type": "array", "minItems": 1, "items": {
            "type": "object", "required": ["id", "text", "category", "source_ids", "status"],
            "properties": {
                "category": {"enum": ["fact", "inference", "dramatization"]},
                "status": {"enum": ["verified", "partially_verified", "unverified"]},
                "source_ids": _strlist}}},
        "open_questions": _strlist,
    },
}

SCRIPT = {
    "type": "object",
    "required": ["title", "target_seconds", "sections"],
    "properties": {
        "title": _str,
        "sections": {"type": "array", "minItems": 3, "items": {
            "type": "object", "required": ["id", "name", "lines"],
            "properties": {"lines": {"type": "array", "minItems": 1, "items": {
                "type": "object", "required": ["id", "text", "claim_ids"],
                "properties": {"text": _str, "claim_ids": _strlist}}}}}},
    },
}

CAMERA = ["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "static"]

STORYBOARD = {
    "type": "object",
    "required": ["style_bible", "cuts"],
    "properties": {
        "style_bible": {"type": "object", "required": ["global_style", "entities"]},
        "cuts": {"type": "array", "minItems": 1, "items": {
            "type": "object",
            "required": ["id", "line_id", "section", "narration", "purpose", "subject", "camera_motion",
                         "asset_type", "prompt", "diagram", "science_notes", "claim_ids"],
            "properties": {
                "id": {"type": "string", "pattern": "^C[0-9]{2,3}$"},
                "camera_motion": {"enum": CAMERA},
                "asset_type": {"enum": ["image", "video", "diagram", "title", "motion"]},
                "prompt": {"type": ["string", "null"]},
                "diagram": {"type": ["object", "null"]},
                "claim_ids": _strlist}}},
    },
}

SHORTS = {
    "type": "object",
    "required": ["shorts"],
    "properties": {"shorts": {"type": "array", "minItems": 2, "maxItems": 3, "items": {
        "type": "object", "required": ["id", "title", "hook_text", "lines", "end_card_text"],
        "properties": {"lines": {"type": "array", "minItems": 3, "items": {
            "type": "object", "required": ["text", "cut_id", "claim_ids"]}}}}}},
}

SCHEMAS = {"plan": PLAN, "research": RESEARCH, "script": SCRIPT, "storyboard": STORYBOARD, "shorts": SHORTS}
