"""Code-drawn explainer graphics (free, exact numbers, no AI hallucinated digits).

Each renderer draws one 1920×1080 PNG from a storyboard `diagram` spec: {"type": ..., "params": {...}}.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
BG_TOP, BG_BOT = (6, 10, 22), (14, 22, 44)
INK = (236, 241, 250)
MUTED = (150, 165, 190)
CYAN = (111, 211, 255)
AMBER = (255, 181, 71)
RED = (255, 107, 107)
GRID = (40, 55, 85)

FONT_DIR = Path("/usr/share/fonts/opentype/inter")


def font(size: int, weight: str = "SemiBold") -> ImageFont.FreeTypeFont:
    for name in (f"Inter-{weight}.otf", "Inter-Regular.otf"):
        p = FONT_DIR / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.truetype("DejaVuSans.ttf", size)


def canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (W, H), BG_TOP)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] * (1 - t) + BG_BOT[i] * t) for i in range(3)))
    # faint star field so diagrams sit in the same world as the footage
    import random
    rnd = random.Random(7)
    for _ in range(260):
        x, y, r = rnd.randrange(W), rnd.randrange(H), rnd.choice([1, 1, 1, 2])
        c = rnd.randrange(60, 140)
        d.ellipse([x, y, x + r, y + r], fill=(c, c, c + 20))
    return img, d


def center_text(d: ImageDraw.ImageDraw, y: int, text: str, f, fill=INK) -> None:
    w = d.textlength(text, font=f)
    d.text(((W - w) / 2, y), text, font=f, fill=fill)


def title(d, text: str, y: int = 90) -> None:
    center_text(d, y, text, font(64, "Bold"))


def glow_circle(img: Image.Image, cx: int, cy: int, r: int, color, blur: int = 30) -> None:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (160,))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    img.paste(layer, (0, 0), layer)


# ---------------------------------------------------------------- renderers

def r_title(img, d, p):
    center_text(d, 430, p["title"], font(110, "Bold"))
    if p.get("subtitle"):
        center_text(d, 590, p["subtitle"], font(48, "Regular"), MUTED)


def r_legend(img, d, p):
    colors = [CYAN, AMBER, RED]
    y = 300
    for (label, desc), col in zip(p["items"], colors):
        d.rounded_rectangle([420, y, 470, y + 50], 10, fill=col)
        d.text((510, y - 8), label, font=font(64, "Bold"), fill=INK)
        d.text((510 + d.textlength(label, font=font(64, "Bold")) + 30, y + 8), desc, font=font(44, "Regular"), fill=MUTED)
        y += 170


def r_timeline(img, d, p):
    title(d, p.get("title", ""))
    ticks = p["ticks"]
    lo, hi = p.get("highlight", [None, None])
    x0, x1, y = 180, W - 180, 560
    d.line([(x0, y), (x1, y)], fill=GRID, width=6)
    step = (x1 - x0) / (len(ticks) - 1)
    if lo is not None:
        d.line([(x0 + lo * step, y), (x0 + hi * step, y)], fill=AMBER, width=10)
    for i, t in enumerate(ticks):
        x = x0 + i * step
        on = lo is not None and lo <= i <= hi
        r = 20 if on else 14
        d.ellipse([x - r, y - r, x + r, y + r], fill=AMBER if on else CYAN)
        f = font(38 if on else 34, "Bold" if on else "Regular")
        w = d.textlength(t, font=f)
        ty = y - 110 if i % 2 == 0 else y + 60
        d.text((x - w / 2, ty), t, font=f, fill=INK if on else MUTED)
    d.text((x1 - 260, y + 160), "not to scale", font=font(28, "Regular"), fill=MUTED)


def r_barycenter(img, d, p):
    title(d, "The Earth–Moon balance point")
    R = 330
    cx, cy = 760, 600
    glow_circle(img, cx, cy, R + 10, (40, 110, 200), 40)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(28, 78, 150), outline=CYAN, width=4)
    scale = R / p["earth_radius_km"]
    bx = cx + p["distance_km"] * scale
    d.line([(cx, cy), (bx, cy)], fill=INK, width=4)
    d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], fill=INK)
    d.ellipse([bx - 16, cy - 16, bx + 16, cy + 16], fill=AMBER)
    d.text((cx - 120, cy + 24), "Earth's center", font=font(32, "Regular"), fill=INK)
    dist = f"≈ {p['distance_km']:,} km"
    d.text(((cx + bx) / 2 - d.textlength(dist, font=font(40, "Bold")) / 2, cy - 70), dist, font=font(40, "Bold"), fill=INK)
    d.text((bx - 110, cy + 30), "balance point", font=font(36, "Bold"), fill=AMBER)
    d.line([(cx + R + 30, cy), (cx + R + 170, cy)], fill=MUTED, width=4)
    d.polygon([(cx + R + 190, cy), (cx + R + 165, cy - 14), (cx + R + 165, cy + 14)], fill=MUTED)
    d.text((cx + R + 210, cy - 22), "toward the Moon", font=font(34, "Regular"), fill=MUTED)
    d.text((cx + R + 60, cy + 120), f"Earth radius ≈ {p['earth_radius_km']:,} km", font=font(34, "Regular"), fill=MUTED)
    d.text((cx + R + 60, cy + 170), f"Earth ≈ {p['mass_ratio']}× the Moon's mass", font=font(34, "Regular"), fill=MUTED)
    center_text(d, H - 90, "Drawn to scale", font(28, "Regular"), MUTED)


def r_bar_compare(img, d, p):
    title(d, p.get("title", ""))
    bars = p["bars"]
    vals = [b["value"] for b in bars]
    use_log = p.get("log", False)
    vmax = max(vals)

    def frac(v):
        if use_log:
            return max(0.04, math.log10(v) / math.log10(vmax))
        return v / vmax

    x0, x1 = 780, W - 460
    top = 300
    gap = 520 // len(bars)
    for i, b in enumerate(bars):
        y = top + i * gap
        col = [CYAN, AMBER, RED][i % 3]
        d.text((120, y + 22), b["label"], font=font(38, "SemiBold"), fill=INK)
        d.rounded_rectangle([x0, y, x0 + (x1 - x0) * frac(b["value"]), y + 90], 14, fill=col)
        d.text((x0 + (x1 - x0) * frac(b["value"]) + 24, y + 18), b.get("text", str(b["value"])),
               font=font(46, "Bold"), fill=INK)
    if use_log:
        center_text(d, H - 100, "logarithmic scale", font(30, "Regular"), MUTED)


def r_log_scale(img, d, p):
    title(d, p.get("title", ""))
    lo, hi = math.log10(p["min"]), math.log10(p["max"])
    x0, x1, y = 200, W - 200, 600
    d.line([(x0, y), (x1, y)], fill=GRID, width=6)
    for e in range(int(math.floor(lo)), int(math.ceil(hi)) + 1):
        x = x0 + (e - lo) / (hi - lo) * (x1 - x0)
        d.line([(x, y - 18), (x, y + 18)], fill=MUTED, width=3)
        lab = f"{10 ** e:g} {p['unit']}"
        d.text((x - d.textlength(lab, font=font(28, 'Regular')) / 2, y + 34), lab, font=font(28, "Regular"), fill=MUTED)
    for i, pt in enumerate(p["points"]):
        x = x0 + (math.log10(pt["value"]) - lo) / (hi - lo) * (x1 - x0)
        col = [AMBER, CYAN][i % 2]
        glow_circle(img, int(x), y, 26, col, 18)
        d.ellipse([x - 18, y - 18, x + 18, y + 18], fill=col)
        lab = f"{pt['label']}: ≈ {pt['value']:g} {p['unit']}"
        f = font(40, "Bold")
        tw = d.textlength(lab, font=f)
        tx = min(max(60, x - tw / 2), W - 60 - tw)
        d.text((tx, y - 120 - i * 0), lab, font=f, fill=col)
    center_text(d, H - 100, "logarithmic scale — each step is 10× brighter", font(30, "Regular"), MUTED)


def r_tilt(img, d, p):
    title(d, p.get("title", ""))
    cx, cy, R = W // 2, 600, 300
    glow_circle(img, cx, cy, R + 10, (40, 110, 200), 40)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(28, 78, 150), outline=CYAN, width=4)
    a = math.radians(p["angle"])
    L = R + 70
    d.line([(cx, cy - L), (cx, cy + L)], fill=MUTED, width=3)
    dx, dy = math.sin(a) * L, math.cos(a) * L
    d.line([(cx - dx, cy + dy), (cx + dx, cy - dy)], fill=AMBER, width=8)
    # equator
    ex, ey = math.cos(a) * R, math.sin(a) * R
    d.line([(cx - ex, cy - ey), (cx + ex, cy + ey)], fill=INK, width=3)
    d.arc([cx - 160, cy - 160, cx + 160, cy + 160], 270, 270 + p["angle"], fill=AMBER, width=6)
    d.text((cx - 190, cy - 250), f"{p['angle']}°", font=font(52, "Bold"), fill=AMBER)
    d.text((cx + dx + 20, cy - dy - 10), "spin axis", font=font(32, "Regular"), fill=AMBER)
    if p.get("caption"):
        center_text(d, H - 80, p["caption"], font(40, "Regular"), MUTED)


def r_range_compare(img, d, p):
    title(d, p.get("title", ""))
    vmin, vmax = p["min"], p["max"]
    x0, x1 = 560, W - 160

    def X(v):
        return x0 + (v - vmin) / (vmax - vmin) * (x1 - x0)

    ys = [330 + i * 210 for i in range(len(p["ranges"]))]
    axis_y = ys[-1] + 150
    d.line([(x0, axis_y), (x1, axis_y)], fill=GRID, width=4)
    for v in range(vmin, vmax + 1, 15):
        d.line([(X(v), axis_y - 12), (X(v), axis_y + 12)], fill=MUTED, width=3)
        lab = f"{v}{p['unit']}"
        d.text((X(v) - d.textlength(lab, font=font(30, 'Regular')) / 2, axis_y + 24), lab, font=font(30, "Regular"), fill=MUTED)
    if p.get("marker") is not None:
        mx = X(p["marker"])
        for yy in range(260, axis_y, 22):
            d.line([(mx, yy), (mx, yy + 11)], fill=INK, width=2)
        d.text((mx + 10, 250), f"today {p['marker']}{p['unit']}", font=font(28, "Regular"), fill=INK)
    for i, (r, y) in enumerate(zip(p["ranges"], ys)):
        col = [CYAN, RED, AMBER][i % 3]
        d.text((100, y + 14), r["label"], font=font(38, "SemiBold"), fill=INK)
        lo_x, hi_x = X(r["lo"]), max(X(r["hi"]), X(r["lo"]) + 12)
        d.rounded_rectangle([lo_x, y, hi_x, y + 80], 12, fill=col)
        inside = hi_x + 420 >= W
        tx = lo_x + 20 if inside else hi_x + 20
        d.text((tx, y + 16), r.get("text", ""), font=font(40, "Bold"), fill=BG_TOP if inside else INK)
    if p.get("footnote"):
        center_text(d, H - 70, p["footnote"], font(26, "Regular"), MUTED)


def r_pie(img, d, p):
    title(d, p.get("title", ""))
    cx, cy, R = 760, 610, 300
    total = sum(s["value"] for s in p["slices"])
    start = -90.0
    cols = [CYAN, AMBER, RED]
    for i, s in enumerate(p["slices"]):
        ext = 360 * s["value"] / total
        d.pieslice([cx - R, cy - R, cx + R, cy + R], start, start + ext, fill=cols[i % 3], outline=BG_TOP, width=6)
        start += ext
    y = 470
    for i, s in enumerate(p["slices"]):
        d.rounded_rectangle([1180, y, 1230, y + 50], 8, fill=cols[i % 3])
        pct = s["value"] / total
        frac_txt = next((v for k, v in ((2 / 3, "≈ ⅔"), (1 / 3, "≈ ⅓")) if abs(pct - k) < 1e-6),
                        f"{pct:.0%}")
        d.text((1260, y - 6), f"{s['label']}  {frac_txt}", font=font(56, "Bold"), fill=INK)
        y += 110
    if p.get("caption"):
        center_text(d, H - 110, p["caption"], font(36, "Regular"), MUTED)


def r_number_cards(img, d, p):
    cards = p["cards"]
    cw, ch, gap = 700, 420, 120
    x = (W - (cw * len(cards) + gap * (len(cards) - 1))) / 2
    for i, c in enumerate(cards):
        col = [CYAN, AMBER][i % 2]
        d.rounded_rectangle([x, 330, x + cw, 330 + ch], 28, outline=col, width=5, fill=(14, 24, 46))
        f = font(130, "Bold")
        w = d.textlength(c["value"], font=f)
        d.text((x + (cw - w) / 2, 400), c["value"], font=f, fill=col)
        f2 = font(40, "Regular")
        w2 = d.textlength(c["label"], font=f2)
        d.text((x + (cw - w2) / 2, 610), c["label"], font=f2, fill=INK)
        x += cw + gap


def r_spring_neap(img, d, p):
    title(d, "Spring and neap tides")

    def scene(ox, label, angle_deg, note):
        sx, sy = ox + 60, 560
        glow_circle(img, sx, sy, 60, AMBER, 25)
        d.ellipse([sx - 50, sy - 50, sx + 50, sy + 50], fill=AMBER)
        ex, ey = ox + 470, 560
        d.ellipse([ex - 46, ey - 46, ex + 46, ey + 46], fill=(28, 78, 150), outline=CYAN, width=3)
        a = math.radians(angle_deg)
        mx, my = ex + math.cos(a) * 170, ey - math.sin(a) * 170
        d.ellipse([mx - 22, my - 22, mx + 22, my + 22], fill=(200, 200, 205))
        d.text((ox + 160, 760), label, font=font(44, "Bold"), fill=INK)
        d.text((ox + 160, 820), note, font=font(32, "Regular"), fill=MUTED)

    scene(160, "Spring tide", 0, "Sun and Moon in line: bigger tides")
    scene(1000, "Neap tide", 90, "At right angles: smaller tides")
    # cross-out band
    d.rounded_rectangle([420, 920, W - 420, 1010], 16, fill=(70, 20, 30))
    center_text(d, 935, "No Moon → no spring/neap cycle", font(44, "Bold"), RED)


RENDERERS = {
    "title": r_title, "legend": r_legend, "timeline": r_timeline, "barycenter": r_barycenter,
    "bar_compare": r_bar_compare, "log_scale": r_log_scale, "tilt": r_tilt,
    "range_compare": r_range_compare, "pie": r_pie, "number_cards": r_number_cards,
    "spring_neap": r_spring_neap,
}


def render(spec: dict, out: Path) -> Path:
    kind = spec["type"]
    if kind not in RENDERERS:
        raise ValueError(f"unknown diagram type '{kind}' (known: {', '.join(RENDERERS)})")
    img, d = canvas()
    RENDERERS[kind](img, d, spec.get("params", {}))
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    return out
