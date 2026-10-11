"""Channel artwork: icon (800×800) and banner (2560×1440) in the same style as the videos.

    python -m src.branding            → writes branding/icon.png, branding/banner.png, branding/*_preview.png

YouTube shows the icon as a circle and crops the banner per device; everything important sits inside the
1546×423 "safe area" in the middle of the banner.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

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


def _earth_with_missing_moon(img: Image.Image, cx: float, cy: float, r: int, scale: float = 1.0,
                             moon_angle: float = 0.45, orbit: float = 1.75) -> None:
    """Earth plus a dashed, empty orbit and an empty dashed circle where the Moon should be."""
    d = ImageDraw.Draw(img)
    rx, ry = r * orbit, r * 0.55
    _dashed_ellipse(d, cx, cy, rx, ry, (110, 130, 175), width=max(2, int(3 * scale)), dash=int(14 * scale), gap=int(10 * scale))
    motion.glow(img, cx, cy, int(r * 1.08), (60, 130, 255), 0.4)
    g = motion.render_globe(r, spin=2.2, tilt_deg=23.4, sun=(-0.75, 0.35, 0.55))
    img.paste(g, (int(cx - r), int(cy - r)), g)
    d = ImageDraw.Draw(img)
    # front half of the orbit passes in front of the planet
    mx, my = cx + rx * math.cos(moon_angle), cy + ry * math.sin(moon_angle)
    mr = r * 0.27
    motion.glow(img, mx, my, int(mr * 1.6), (255, 181, 71), 0.35)
    _dashed_ellipse(ImageDraw.Draw(img), mx, my, mr, mr, motion.AMBER, width=max(3, int(5 * scale)),
                    dash=int(9 * scale), gap=int(7 * scale))


def icon(size: int = 800) -> Image.Image:
    img = _sky(size, size, seed=3)
    _earth_with_missing_moon(img, size * 0.5, size * 0.47, int(size * 0.27), scale=size / 800,
                             moon_angle=1.15, orbit=1.5)
    return img


def banner(name: str, w: int = 2560, h: int = 1440) -> Image.Image:
    img = _sky(w, h, seed=5)
    sx, sy, sw, sh = (w - 1546) // 2, (h - 423) // 2, 1546, 423  # safe area on every device
    _earth_with_missing_moon(img, sx + 250, sy + sh / 2, 150, scale=0.75, moon_angle=math.pi - 0.5, orbit=1.6)
    tx = sx + 560
    motion.text(img, (tx, sy + 120), name, motion.font(132, "Black"), motion.INK, 1, "lm")
    motion.text(img, (tx, sy + 245), TAGLINE, motion.font(56, "Bold"), motion.AMBER, 1, "lm")
    motion.text(img, (tx, sy + 325), SUBLINE, motion.font(40, "Regular"), motion.MUTED, 1, "lm")
    return img


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


def main() -> None:
    name = load_settings()["channel"]["name"]
    OUT.mkdir(exist_ok=True)
    ic, bn = icon(), banner(name)
    ic.save(OUT / "icon.png")
    bn.save(OUT / "banner.png", optimize=True)
    preview(ic, "icon").save(OUT / "icon_preview.png")
    preview(bn, "banner").save(OUT / "banner_preview.png")
    print(f"✓ {OUT / 'icon.png'} ({ic.size[0]}×{ic.size[1]})\n✓ {OUT / 'banner.png'} ({bn.size[0]}×{bn.size[1]})")


if __name__ == "__main__":
    main()
