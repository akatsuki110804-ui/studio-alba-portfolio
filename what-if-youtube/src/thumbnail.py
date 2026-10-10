"""STEP 9: thumbnails — AI background + text composited locally (so letters are never garbled).

Specs live in thumbnails/thumbnails.json. A missing background is never silently replaced: the thumbnail
is rendered on a plain draft background with a DRAFT banner and reported as not publishable.
"""
from __future__ import annotations

from PIL import Image, ImageDraw, ImageFilter

from . import asset_manager as am
from . import diagrams
from .common import PipelineError, Project, write_json

TW, TH = 1280, 720
AMBER = (255, 190, 60)


def _background(project: Project, spec: dict) -> tuple[Image.Image, bool]:
    st = am.load_state(project).get(spec["id"])
    items = {i["id"]: i for i in am.generation_items(project)}
    if st and st.get("status") == "ready" and st.get("fingerprint") == items[spec["id"]]["fingerprint"]:
        p = project.path(st["path"])
        if p.exists():
            return Image.open(p).convert("RGB").resize((TW, TH), Image.LANCZOS), True
    img, _ = diagrams.canvas()
    return img.resize((TW, TH)), False


def render(project: Project, spec: dict) -> dict:
    bg, real = _background(project, spec)
    # darken the text side so the title stays readable at small sizes
    shade = Image.new("L", (TW, TH), 0)
    sd = ImageDraw.Draw(shade)
    for x in range(TW):
        a = int(max(0, 1 - x / (TW * 0.62)) * 190)
        sd.line([(x, 0), (x, TH)], fill=a)
    bg = Image.composite(Image.new("RGB", (TW, TH), (0, 0, 0)), bg, shade)
    d = ImageDraw.Draw(bg)
    lines = spec["text"]
    size = 132 if len(lines) <= 2 else 108
    f = diagrams.font(size, "ExtraBold")
    total_h = len(lines) * size * 1.02
    y = (TH - total_h) / 2
    for ln in lines:
        col = AMBER if ln == spec.get("accent") else (255, 255, 255)
        # drop shadow for legibility on busy backgrounds
        shadow = Image.new("RGBA", (TW, TH), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).text((62, y + 6), ln, font=f, fill=(0, 0, 0, 200))
        bg.paste(shadow.filter(ImageFilter.GaussianBlur(6)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(6)))
        d.text((56, y), ln, font=f, fill=col, stroke_width=3, stroke_fill=(0, 0, 0))
        y += size * 1.02
    if not real:
        d.rectangle([0, 0, TW, 60], fill=(150, 30, 40))
        d.text((20, 10), "DRAFT — background image pending", font=diagrams.font(36, "Bold"), fill=(255, 255, 255))
    out = project.path("thumbnails", f"{spec['id']}{'' if real else '_DRAFT'}.jpg")
    for stale in project.path("thumbnails").glob(f"{spec['id']}*.jpg"):
        stale.unlink()
    bg.save(out, quality=90)
    small = bg.resize((320, 180), Image.LANCZOS)
    small.save(project.path("previews", f"thumb_{spec['id']}_small.png"))
    return {"id": spec["id"], "output": str(out.relative_to(project.dir)), "publishable": real}


def make_thumbnails(project: Project) -> list[dict]:
    specs = am.thumbnail_specs(project)
    if not specs:
        raise PipelineError("thumbnails/thumbnails.json missing or empty")
    with project.stage("thumbnails", {"count": len(specs)}) as rec:
        res = [render(project, s) for s in specs]
        write_json(project.path("thumbnails", "thumbnails_manifest.json"), res)
        rec["outputs"] += [r["output"] for r in res]
        drafts = [r["id"] for r in res if not r["publishable"]]
        if drafts:
            rec["notes"].append(f"draft backgrounds: {drafts}")
    return res
