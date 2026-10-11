"""Channel artwork: icon (800×800) and banner (2560×1440) in the same style as the videos.

    python -m src.branding   → writes branding/icon.png, banner.png (+ previews) in the chosen style (A_flask)

YouTube shows the icon as a circle and crops the banner per device; everything important sits inside the
1546×423 "safe area" in the middle of the banner.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from . import motion
from .common import ROOT, load_settings

OUT = ROOT / "branding"
TAGLINE = "ありえない「もしも」を、科学でたどる。"
SUBLINE = "宇宙・地球・生命の思考実験ドキュメンタリー"


def _sky(w: int, h: int, seed: int = 7) -> Image.Image:
    import numpy as np
    t = np.linspace(0, 1, h)[:, None, None]
    g = np.array([5, 9, 20])[None, None, :] * (1 - t) + np.array([16, 26, 52])[None, None, :] * t
    img = Image.fromarray(np.broadcast_to(g, (h, w, 3)).astype("uint8").copy())
    d = ImageDraw.Draw(img)
    import random
    r = random.Random(seed)
    for _ in range(int(w * h / 2600)):
        x, y, s = r.random() * w, r.random() * h, r.choice([1, 1, 2, 2, 3])
        c = r.randrange(80, 230)
        d.ellipse([x, y, x + s, y + s], fill=(c, c, min(255, c + 20)))
    return img


def _dashed_ellipse(d: ImageDraw.ImageDraw, cx, cy, rx, ry, color, width=4, dash=10, gap=8, start=0.0):
    n = int(2 * math.pi * max(rx, ry) / (dash + gap))
    for i in range(n):
        a0 = start + i * 2 * math.pi / n
        a1 = a0 + 2 * math.pi / n * dash / (dash + gap)
        pts = [(cx + rx * math.cos(a0 + (a1 - a0) * k / 4), cy + ry * math.sin(a0 + (a1 - a0) * k / 4)) for k in range(5)]
        d.line(pts, fill=color, width=width)


def _nebula(size: int, seed: int = 4) -> np.ndarray:
    """Soft generic nebula (purple/blue/cyan clouds + stars) — not tied to any one episode."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    out = np.zeros((size, size, 3), np.float32) + np.array([8, 12, 32], np.float32)
    for (cx, cy, rad, col) in [(0.35, 0.65, 0.30, (120, 60, 200)), (0.65, 0.45, 0.28, (40, 150, 230)),
                               (0.50, 0.80, 0.22, (200, 70, 160)), (0.70, 0.75, 0.18, (60, 200, 220))]:
        out += np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / rad ** 2) * 2.2)[..., None] * np.array(col, np.float32) * 0.8
    n = rng.random((size // 16 + 2, size // 16 + 2)).astype(np.float32)
    n = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((size + 32, size + 32), Image.BICUBIC)
                   .filter(ImageFilter.GaussianBlur(size / 60)), np.float32)[:size, :size] / 255
    out *= (0.65 + 0.7 * n)[..., None]
    stars = rng.random((size, size)) > 0.9975
    out[stars] = 255
    return np.clip(out, 0, 255)


def _sphere(d_img: Image.Image, cx: float, cy: float, r: float, base=(255, 181, 71), ring: bool = True) -> None:
    """Generic ringed planet (shaded sphere + tilted ring)."""
    S = int(r * 4)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    x, y = (xx - S / 2) / r, (yy - S / 2) / r
    rr = x * x + y * y
    z = np.sqrt(np.clip(1 - rr, 0, 1))
    light = np.clip(-0.55 * x - 0.45 * y + 0.7 * z, 0, 1) * 0.85 + 0.15
    band = 0.88 + 0.12 * np.sin(y * 9)
    col = np.array(base, np.float32)[None, None, :] * (light * band)[..., None]
    alpha = (np.clip((1 - np.sqrt(rr)) * r, 0, 1) * 255).astype(np.uint8)
    sph = Image.fromarray(np.dstack([np.clip(col, 0, 255).astype(np.uint8), alpha]), "RGBA")
    ringc = (255, 225, 170, 255)
    if ring:
        back = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(back).ellipse([S / 2 - r * 1.85, S / 2 - r * 0.5, S / 2 + r * 1.85, S / 2 + r * 0.5],
                                     outline=ringc, width=max(2, int(r * 0.16)))
        back = back.rotate(-18, resample=Image.BICUBIC)
        front = back.copy()
        ImageDraw.Draw(front).rectangle([0, 0, S, S / 2], fill=(0, 0, 0, 0))  # front half = lower part
        d_img.paste(back, (int(cx - S / 2), int(cy - S / 2)), back)
        d_img.paste(sph, (int(cx - S / 2), int(cy - S / 2)), sph)
        d_img.paste(front, (int(cx - S / 2), int(cy - S / 2)), front)
    else:
        d_img.paste(sph, (int(cx - S / 2), int(cy - S / 2)), sph)


def mark_flask(S: int) -> Image.Image:
    """A: lab flask with a small universe inside (What If + Lab)."""
    cx = S / 2
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    br, by = S * 0.30, S * 0.62
    md.ellipse([cx - br, by - br, cx + br, by + br], fill=255)
    nw = S * 0.17
    md.rectangle([cx - nw / 2, S * 0.16, cx + nw / 2, by - br * 0.6], fill=255)
    stroke = int(S * 0.028)
    outer = mask.filter(ImageFilter.MaxFilter(stroke * 2 + 1))
    neb = Image.fromarray(_nebula(S).astype(np.uint8))
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(neb, (0, 0), mask)
    _sphere(img, cx + S * 0.06, by + S * 0.03, S * 0.075)
    d = ImageDraw.Draw(img)
    for (bx, byy, rr) in [(cx - S * 0.02, S * 0.33, S * 0.018), (cx + S * 0.025, S * 0.25, S * 0.012),
                          (cx - S * 0.12, by - S * 0.05, S * 0.014)]:
        d.ellipse([bx - rr, byy - rr, bx + rr, byy + rr], outline=(220, 240, 255, 230), width=max(2, int(S * 0.006)))
    ring = Image.eval(outer, lambda v: v)
    ring = Image.fromarray(np.clip(np.asarray(outer, np.int16) - np.asarray(mask, np.int16), 0, 255).astype(np.uint8))
    img.paste(Image.new("RGBA", (S, S), (236, 241, 250, 255)), (0, 0), ring)
    d = ImageDraw.Draw(img)
    lip_w, lip_h = S * 0.25, S * 0.045
    d.rounded_rectangle([cx - lip_w / 2, S * 0.13, cx + lip_w / 2, S * 0.13 + lip_h], radius=int(lip_h / 2),
                        fill=(236, 241, 250, 255))
    return img


def mark_question(S: int) -> Image.Image:
    """B: a question mark whose dot is a planet."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy, r = S / 2, S * 0.37, S * 0.19
    w = int(S * 0.085)
    col = (236, 241, 250, 255)
    d.arc([cx - r, cy - r, cx + r, cy + r], 190, 450, fill=col, width=w)
    d.line([(cx, cy + r - w / 2), (cx, cy + r + S * 0.09)], fill=col, width=w)
    d.ellipse([cx - w / 2, cy + r + S * 0.09 - w / 2, cx + w / 2, cy + r + S * 0.09 + w / 2], fill=col)
    lx, ly = cx + r * math.cos(math.radians(190)), cy + r * math.sin(math.radians(190))
    d.ellipse([lx - w / 2, ly - w / 2, lx + w / 2, ly + w / 2], fill=col)
    _sphere(img, cx, S * 0.80, S * 0.065, base=(255, 181, 71))
    return img


MARKS = {"A_flask": mark_flask, "B_question": mark_question}


def icon(style: str = "A_flask", size: int = 800) -> Image.Image:
    S = size * 2  # supersample for clean edges
    bg = _sky(S, S, seed=3)
    motion.glow(bg, S / 2, S / 2, int(S * 0.33), (70, 90, 200), 0.35)
    m = MARKS[style](S)
    bg.paste(m, (0, 0), m)
    return bg.resize((size, size), Image.LANCZOS)


def banner(name: str, style: str = "A_flask", w: int = 2560, h: int = 1440) -> Image.Image:
    img = Image.fromarray(_nebula_wide(w, h))
    sx, sy, sw, sh = (w - 1546) // 2, (h - 423) // 2, 1546, 423  # safe area on every device
    m = MARKS[style](760).resize((380, 380), Image.LANCZOS)
    img.paste(m, (sx + 40, sy + (sh - 380) // 2), m)
    tx = sx + 480
    motion.text(img, (tx, sy + 120), name, motion.font(140, "Black"), motion.INK, 1, "lm")
    motion.text(img, (tx, sy + 250), TAGLINE, motion.font(56, "Bold"), motion.AMBER, 1, "lm")
    motion.text(img, (tx, sy + 330), SUBLINE, motion.font(40, "Regular"), motion.MUTED, 1, "lm")
    return img


def _nebula_wide(w: int, h: int) -> np.ndarray:
    sq = _nebula(1024, seed=9)
    big = Image.fromarray(sq.astype(np.uint8)).resize((w, w), Image.BICUBIC).crop((0, (w - h) // 2, w, (w - h) // 2 + h))
    arr = np.asarray(big, np.float32) * 0.55  # keep it dark so the text reads
    sky = np.asarray(_sky(w, h, seed=5), np.float32)
    return np.clip(np.maximum(arr, sky), 0, 255).astype(np.uint8)


def preview(img: Image.Image, kind: str) -> Image.Image:
    """How it will look: icon in a circle at small sizes; banner with the safe area outlined."""
    if kind == "icon":
        out = Image.new("RGB", (560, 200), (24, 24, 28))
        x = 20
        for s in (176, 88, 40):
            m = Image.new("L", (s, s), 0)
            ImageDraw.Draw(m).ellipse([0, 0, s - 1, s - 1], fill=255)
            out.paste(img.resize((s, s), Image.LANCZOS), (x, (200 - s) // 2), m)
            x += s + 40
        return out
    p = img.copy()
    d = ImageDraw.Draw(p)
    sx, sy = (p.width - 1546) // 2, (p.height - 423) // 2
    d.rectangle([sx, sy, sx + 1546, sy + 423], outline=(255, 80, 80), width=4)
    return p.resize((p.width // 4, p.height // 4), Image.LANCZOS)


CHOSEN = "A_flask"  # chosen 2026-10-11


def main() -> None:
    """Writes the chosen style as icon.png / banner.png. `python -m src.branding B_question` renders another style."""
    import sys
    style = sys.argv[1] if len(sys.argv) > 1 else CHOSEN
    name = load_settings()["channel"]["name"]
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()
    ic, bn = icon(style), banner(name, style)
    ic.save(OUT / "icon.png")
    bn.save(OUT / "banner.png", optimize=True)
    preview(ic, "icon").save(OUT / "preview_icon.png")
    preview(bn, "banner").save(OUT / "preview_banner.png")
    print(f"✓ {style}: icon.png ({ic.width}×{ic.height}) / banner.png ({bn.width}×{bn.height})")


if __name__ == "__main__":
    main()
