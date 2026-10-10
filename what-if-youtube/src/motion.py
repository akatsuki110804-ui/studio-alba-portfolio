"""Code-rendered motion graphics — every non-AI shot moves.

Each storyboard cut with asset_type "motion" carries a spec {"type": ..., "params": {...}} in its `diagram`
field. A renderer turns it into frames (1920×1080) that are piped straight into FFmpeg, so numbers are always
exact and nothing is a still image: bars grow, orbits turn, tides rise and fall, stars drift.

The globe uses Natural Earth 1:110m land polygons (public domain, assets_library/geo) so continents are real.
"""
from __future__ import annotations

import json
import math
import random
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .common import ROOT, PipelineError

W, H = 1920, 1080
BG_TOP, BG_BOT = np.array([5, 9, 20]), np.array([14, 22, 44])
INK = (236, 241, 250)
MUTED = (150, 165, 190)
CYAN = (111, 211, 255)
AMBER = (255, 181, 71)
RED = (255, 107, 107)
GREEN = (120, 220, 160)
GRID = (40, 55, 85)
BG_MID = (10, 16, 32)
SAFE_Y = H - 260  # lowest baseline for graphic text; the band below is reserved for subtitles

FONT_DIRS = [ROOT / "models" / "fonts", Path("/usr/share/fonts/opentype/inter")]


# ------------------------------------------------------------------ basics
@lru_cache(maxsize=64)
def font(size: int, weight: str = "Bold") -> ImageFont.FreeTypeFont:
    for d in FONT_DIRS:
        for name in (f"NotoSansJP-{weight}.otf", "NotoSansJP-Bold.otf"):
            if (d / name).exists():
                return ImageFont.truetype(str(d / name), size)
    for p in ("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    raise PipelineError("No Japanese font found — download Noto Sans JP into models/fonts (README › Setup)")


def clamp01(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def eo(x: float) -> float:
    """ease-out cubic"""
    x = clamp01(x)
    return 1 - (1 - x) ** 3


def eio(x: float) -> float:
    x = clamp01(x)
    return 3 * x * x - 2 * x * x * x


def window(t: float, a: float, b: float) -> float:
    """0→1 progress of t through [a, b]."""
    return clamp01((t - a) / max(1e-6, b - a))


def mix(c1, c2, a: float):
    return tuple(int(c1[i] * (1 - a) + c2[i] * a) for i in range(3))


@lru_cache(maxsize=4)
def _gradient(top: tuple, bot: tuple) -> np.ndarray:
    t = np.linspace(0, 1, H)[:, None, None]
    g = np.array(top)[None, None, :] * (1 - t) + np.array(bot)[None, None, :] * t
    return np.broadcast_to(g, (H, W, 3)).astype(np.uint8).copy()


def background(top=tuple(BG_TOP), bot=tuple(BG_BOT)) -> Image.Image:
    return Image.fromarray(_gradient(tuple(top), tuple(bot)))


class Stars:
    def __init__(self, n=320, seed=7, bright=1.0):
        r = random.Random(seed)
        self.s = [(r.random() * W, r.random() * H, r.choice([1, 1, 1, 2, 2, 3]), r.uniform(0.3, 1.0),
                   r.uniform(0, 6.28), r.uniform(0.6, 2.2)) for _ in range(n)]
        self.bright = bright

    def draw(self, d: ImageDraw.ImageDraw, t: float, drift=(6.0, 0.0), twinkle=True, alpha=1.0, rot=0.0,
             pivot=(W * 0.15, -H * 0.4)):
        cr, sr = math.cos(rot * t), math.sin(rot * t)
        for x, y, size, b, ph, sp in self.s:
            if rot:
                dx, dy = x - pivot[0], y - pivot[1]
                x, y = pivot[0] + dx * cr - dy * sr, pivot[1] + dx * sr + dy * cr
            x = (x + drift[0] * t) % W
            y = (y + drift[1] * t) % H
            k = b * (0.75 + 0.25 * math.sin(ph + sp * t) if twinkle else b) * alpha * self.bright
            c = int(60 + 190 * k)
            d.ellipse([x, y, x + size, y + size], fill=(c, c, min(255, c + 20)))


def text(img: Image.Image, xy, s: str, f, color=INK, alpha: float = 1.0, anchor: str = "la", stroke=0):
    """Draw text with opacity (fade) — alpha < 1 is composited through a mask."""
    if alpha <= 0.01 or not s:
        return
    d = ImageDraw.Draw(img)
    if alpha >= 0.99:
        d.text(xy, s, font=f, fill=color, anchor=anchor, stroke_width=stroke, stroke_fill=(0, 0, 0))
        return
    box = d.textbbox(xy, s, font=f, anchor=anchor, stroke_width=stroke)
    x0, y0 = int(box[0]) - 2, int(box[1]) - 2
    mask = Image.new("L", (int(box[2]) - x0 + 4, int(box[3]) - y0 + 4), 0)
    ImageDraw.Draw(mask).text((xy[0] - x0, xy[1] - y0), s, font=f, fill=int(255 * alpha), anchor=anchor,
                              stroke_width=stroke)
    img.paste(Image.new("RGB", mask.size, color), (x0, y0), mask)


@lru_cache(maxsize=32)
def glow_sprite(r: int, color: tuple, strength: float = 1.0) -> Image.Image:
    size = r * 4
    yy, xx = np.mgrid[0:size, 0:size] - size / 2
    dist = np.sqrt(xx ** 2 + yy ** 2) / r
    a = np.clip(np.exp(-dist ** 2 * 1.2) * strength, 0, 1)
    arr = np.zeros((size, size, 4), np.uint8)
    arr[..., :3] = color
    arr[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def glow(img: Image.Image, cx: float, cy: float, r: int, color: tuple, strength: float = 1.0) -> None:
    sp = glow_sprite(int(r), tuple(color), round(strength, 2))
    img.paste(sp, (int(cx - sp.width / 2), int(cy - sp.height / 2)), sp)


def note(img: Image.Image, s: str, alpha: float = 1.0) -> None:
    """Small caveat/footnote, top-right (keeps the subtitle zone clear)."""
    text(img, (W - 40, 28), s, font(26, "Regular"), MUTED, alpha, "ra")


def title_bar(img: Image.Image, s: str, t: float, y: int = 70) -> None:
    text(img, (W / 2, y + 30 * (1 - eo(window(t, 0, 0.7)))), s, font(60, "Bold"), INK, eo(window(t, 0, 0.7)), "mt")


def count_text(value: str, k: float) -> str:
    """Animate the first number inside a label ('3.8 cm', '+約2 ms', '秒速 約29,780 m') from 0 to its value."""
    import re
    m = re.search(r"\d[\d,]*(\.\d+)?", value)
    if not m or k >= 1:
        return value
    num = float(m.group(0).replace(",", ""))
    dec = len(m.group(1)) - 1 if m.group(1) else 0
    cur = num * eo(k)
    s = f"{cur:,.{dec}f}" if "," in m.group(0) else f"{cur:.{dec}f}"
    return value[:m.start()] + s + value[m.end():]


# ------------------------------------------------------------------ globe
@lru_cache(maxsize=1)
def earth_texture(w: int = 1440, h: int = 720) -> np.ndarray:
    geo = json.loads((ROOT / "assets_library" / "geo" / "ne_110m_land.geojson").read_text())
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    for feat in geo["features"]:
        g = feat["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            ring = [((lon + 180) / 360 * w, (90 - lat) / 180 * h) for lon, lat in poly[0]]
            md.polygon(ring, fill=255)
    land = np.asarray(mask, np.float32) / 255
    lat = np.linspace(90, -90, h)[:, None]
    rng = np.random.default_rng(3)

    def noise(scale, seed_shift=0):
        g = rng.random((h // scale + 2, w // scale + 2)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w + 2 * scale, h + 2 * scale), Image.BICUBIC)
        im = im.filter(ImageFilter.GaussianBlur(max(1, scale // 3)))
        return np.asarray(im, np.float32)[:h, :w] / 255

    n = 0.5 * noise(48) + 0.3 * noise(16) + 0.2 * noise(6)
    ocean = np.stack([10 + 25 * n, 50 + 40 * n, 120 + 50 * n], -1) * (0.75 + 0.25 * np.cos(np.radians(lat)))[..., None]
    veg = np.stack([60 + 60 * n, 100 + 50 * n, 50 + 30 * n], -1)
    desert = np.stack([175 + 40 * n, 150 + 30 * n, 100 + 20 * n], -1)
    dry = np.clip(1 - np.abs(np.abs(lat) - 25) / 12, 0, 1)
    landc = veg * (1 - dry[..., None] * 0.8) + desert * (dry[..., None] * 0.8)
    ice = np.clip((np.abs(lat) - 62) / 8, 0, 1)
    landc = landc * (1 - ice[..., None]) + np.array([235, 240, 245]) * ice[..., None]
    tex = ocean * (1 - land[..., None]) + landc * land[..., None]
    clouds = np.clip((0.55 * noise(40) + 0.45 * noise(12) - 0.52) * 3.2, 0, 1) * 0.85
    tex = tex * (1 - clouds[..., None]) + 245 * clouds[..., None]
    return np.clip(tex, 0, 255).astype(np.float32)


@lru_cache(maxsize=8)
def _disk(r: int):
    yy, xx = np.mgrid[-r:r, -r:r].astype(np.float32) + 0.5
    x, y = xx / r, -yy / r
    rr = x * x + y * y
    inside = rr <= 1
    z = np.sqrt(np.clip(1 - rr, 0, 1))
    return x, y, z, inside, rr


def render_globe(r: int, spin: float, tilt_deg: float, sun=(-0.8, 0.2, 0.55), dark: float = 0.0,
                 roll_extra: float = 0.0) -> Image.Image:
    """Orthographic Earth. spin: longitude rotation (rad); tilt: axis roll in the image plane (deg)."""
    tex = earth_texture()
    th, tw = tex.shape[:2]
    x, y, z, inside, rr = _disk(r)
    a = math.radians(tilt_deg + roll_extra)
    ca, sa = math.cos(a), math.sin(a)
    # undo the in-plane axis tilt so the planet's axis is "up"
    px, py = x * ca - y * sa, x * sa + y * ca
    lat = np.arcsin(np.clip(py, -1, 1))
    lon = np.arctan2(px, z) + spin
    u = ((lon / (2 * np.pi) + 0.5) % 1.0 * (tw - 1)).astype(np.int32)
    v = ((0.5 - lat / np.pi) * (th - 1)).astype(np.int32)
    col = tex[v, u]
    s = np.array(sun, np.float32)
    s /= np.linalg.norm(s)
    lam = x * s[0] + y * s[1] + z * s[2]
    light = np.clip(lam * 1.4 + 0.15, 0, 1) ** 0.9 * (1 - dark) + 0.05
    col = col * light[..., None]
    rim = np.clip((rr - 0.82) / 0.18, 0, 1) ** 2
    col = col * (1 - rim[..., None] * 0.5) + np.array([90, 160, 255]) * (rim[..., None] * 0.55 * np.clip(lam + 0.4, 0, 1)[..., None])
    alpha = np.clip((1 - np.sqrt(rr)) * r * 1.5, 0, 1) * inside
    out = np.dstack([np.clip(col, 0, 255), alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def paste_globe(img: Image.Image, cx: float, cy: float, r: int, spin: float, tilt: float, sun=(-0.8, 0.2, 0.55),
                dark: float = 0.0, atmosphere: bool = True) -> None:
    if atmosphere:
        glow(img, cx, cy, int(r * 1.05), (60, 130, 255), 0.35)
    g = render_globe(r, spin, tilt, sun, dark)
    img.paste(g, (int(cx - r), int(cy - r)), g)


# ------------------------------------------------------------------ renderers
class Renderer:
    stars_n = 320

    def __init__(self, p: dict, T: float):
        self.p, self.T = p, T
        self.stars = Stars(self.stars_n)

    def base(self, t: float, drift=(5.0, 0.0)) -> Image.Image:
        img = background()
        self.stars.draw(ImageDraw.Draw(img), t, drift)
        return img

    def frame(self, t: float) -> Image.Image:  # pragma: no cover - overridden
        raise NotImplementedError


class Title(Renderer):
    def frame(self, t):
        img = self.base(t, (12, 2))
        p = self.p
        k = eo(window(t, 0.2, 1.3))
        size = 120 if len(p["title"]) <= 8 else 92
        text(img, (W / 2, 470 + 40 * (1 - k)), p["title"], font(size, "Black"), INK, k, "mm")
        if p.get("subtitle"):
            k2 = eo(window(t, 1.0, 2.0))
            for i, line in enumerate(p["subtitle"].split("\n")):
                text(img, (W / 2, 610 + i * 64 + 20 * (1 - k2)), line, font(46 if i == 0 else 34, "Regular"), MUTED, k2, "mm")
        if p.get("mode") == "question":
            pulse = 0.5 + 0.5 * math.sin(t * 2.2)
            glow(img, W / 2, 470, 260, (60, 90, 160), 0.15 + 0.1 * pulse)
        return img


class Legend(Renderer):
    def frame(self, t):
        img = self.base(t)
        items = self.p["items"]
        cols = [CYAN, AMBER, RED, GREEN]
        gap = min(1.4, self.T * 0.6 / max(1, len(items)))
        n = len(items)
        y0 = H / 2 - (n - 1) * 85
        for i, (label, desc) in enumerate(items):
            k = eo(window(t, 0.3 + i * gap, 0.9 + i * gap))
            if k <= 0:
                continue
            y = y0 + i * 170
            x = 380 - 60 * (1 - k)
            ImageDraw.Draw(img).rounded_rectangle([x, y - 26, x + 52, y + 26], 10, fill=mix(BG_MID, cols[i % 4], k))
            text(img, (x + 90, y), label, font(64, "Black"), INK, k, "lm")
            if desc:
                lw = ImageDraw.Draw(img).textlength(label, font=font(64, "Black"))
                text(img, (x + 130 + lw, y + 6), desc, font(40, "Regular"), MUTED, k, "lm")
        return img


class Timeline(Renderer):
    def frame(self, t):
        img = self.base(t)
        d = ImageDraw.Draw(img)
        p = self.p
        title_bar(img, p.get("title", ""), t)
        ticks = p["ticks"]
        lo, hi = p.get("highlight", [0, len(ticks) - 1])
        x0, x1, y = 180, W - 180, 560
        step = (x1 - x0) / (len(ticks) - 1)
        draw_k = eo(window(t, 0.2, 1.4))
        d.line([(x0, y), (x0 + (x1 - x0) * draw_k, y)], fill=GRID, width=6)
        if p.get("travel"):
            pos = x0 + (x1 - x0) * eio(window(t, 1.0, self.T - 0.6))
            d.line([(x0, y), (pos, y)], fill=AMBER, width=10)
            glow(img, pos, y, 40, AMBER, 0.8)
        else:
            hk = eo(window(t, 1.2, 2.4))
            a, b = x0 + lo * step, x0 + (lo + (hi - lo) * hk) * step
            d.line([(a, y), (b, y)], fill=AMBER, width=10)
        for i, s in enumerate(ticks):
            x = x0 + i * step
            k = eo(window(t, 0.3 + i * 0.15, 0.7 + i * 0.15))
            on = (lo <= i <= hi) and not p.get("travel")
            if p.get("travel"):
                on = x <= x0 + (x1 - x0) * eio(window(t, 1.0, self.T - 0.6)) + 1
            r = (20 if on else 14) * k
            d.ellipse([x - r, y - r, x + r, y + r], fill=AMBER if on else CYAN)
            ty = y - 100 if i % 2 == 0 else y + 70
            text(img, (x, ty), s, font(40 if on else 34, "Bold" if on else "Regular"), INK if on else MUTED, k, "mm")
        text(img, (x1, y + 200), "※ 時間軸は等間隔ではありません", font(28, "Regular"), MUTED, draw_k, "rm")
        return img


class Barycenter(Renderer):
    def frame(self, t):
        img = self.base(t, (3, 0))
        p = self.p
        title_bar(img, "地球と月の共通重心", t)
        R = 250
        bx, by = 760, 520
        scale = R / p["earth_radius_km"]
        orb = p["distance_km"] * scale
        ang = t * 2 * math.pi / 9.0  # one 'month' every 9 s
        ex, ey = bx - orb * math.cos(ang), by - orb * math.sin(ang) * 0.35
        d = ImageDraw.Draw(img)
        d.ellipse([bx - orb, by - orb * 0.35, bx + orb, by + orb * 0.35], outline=(70, 90, 130), width=2)
        paste_globe(img, ex, ey, R, spin=t * 0.4, tilt=23.4, sun=(-0.9, 0.3, 0.4))
        d = ImageDraw.Draw(img)
        k = eo(window(t, 0.8, 1.6))
        d.ellipse([ex - 9, ey - 9, ex + 9, ey + 9], fill=INK)
        d.line([(ex, ey), (bx, by)], fill=INK, width=3)
        glow(img, bx, by, 34, AMBER, 0.9)
        d.ellipse([bx - 14, by - 14, bx + 14, by + 14], fill=AMBER)
        text(img, (bx, by + 40), "共通重心", font(38, "Bold"), AMBER, k, "mt")
        mx, my = bx + 560 * math.cos(ang), by + 560 * math.sin(ang) * 0.35
        text(img, (min(W - 120, mx), my), "→ 月の方向", font(32, "Regular"), MUTED, k * 0.9, "lm")
        k2 = eo(window(t, 1.6, 2.6))
        text(img, (1300, 300), f"中心から 約{p['distance_km']:,} km", font(52, "Black"), INK, k2, "la")
        text(img, (1300, 380), f"地球の半径 約{p['earth_radius_km']:,} km", font(36, "Regular"), MUTED, k2, "la")
        text(img, (1300, 430), f"地球の質量は月の 約{p['mass_ratio']}倍", font(36, "Regular"), MUTED, k2, "la")
        text(img, (1300, 480), "→ 重心は地球の内部", font(36, "Bold"), AMBER, k2, "la")
        note(img, "地球の大きさと重心の位置は縮尺どおり（月までの距離は省略）", k)
        return img


class BarCompare(Renderer):
    def frame(self, t):
        img = self.base(t)
        d = ImageDraw.Draw(img)
        p = self.p
        title_bar(img, p.get("title", ""), t)
        bars, vmax = p["bars"], max(b["value"] for b in p["bars"])
        log = p.get("log", False)

        def frac(v):
            return max(0.04, math.log10(v) / math.log10(vmax)) if log else v / vmax

        x0, x1, top = 720, W - 460, 330
        gap = 500 // len(bars)
        for i, b in enumerate(bars):
            y = top + i * gap
            k = eo(window(t, 0.6 + i * 0.6, 2.0 + i * 0.6))
            col = [CYAN, AMBER, RED][i % 3]
            text(img, (x0 - 40, y + 45), b["label"], font(42, "Bold"), INK, eo(window(t, 0.3 + i * 0.6, 1.0 + i * 0.6)), "rm")
            if k > 0:
                w = (x1 - x0) * frac(b["value"]) * k
                d.rounded_rectangle([x0, y, x0 + max(w, 8), y + 90], 14, fill=col)
                text(img, (x0 + w + 24, y + 45), count_text(b.get("text", str(b["value"])), k), font(48, "Black"), INK, 1, "lm")
        if log:
            note(img, "対数目盛（1目盛りで10倍）", eo(window(t, 1, 2)))
        return img


class Orbit(Renderer):
    def frame(self, t):
        img = self.base(t, (2, 0))
        d = ImageDraw.Draw(img)
        cx, cy, R = W / 2, H / 2 + 30, 360
        glow(img, cx, cy, 120, (255, 190, 90), 0.9)
        d.ellipse([cx - 46, cy - 46, cx + 46, cy + 46], fill=(255, 220, 140))
        for a in range(0, 360, 3):
            r1 = math.radians(a)
            d.point((cx + R * math.cos(r1), cy + R * 0.42 * math.sin(r1)), fill=(80, 100, 140))
        vanish = self.T * 0.35
        ang = -0.6 + t * 0.32
        ex, ey = cx + R * math.cos(ang), cy + R * 0.42 * math.sin(ang)
        for i in range(40):  # trail
            a2 = ang - i * 0.012
            tx, ty = cx + R * math.cos(a2), cy + R * 0.42 * math.sin(a2)
            c = int(120 * (1 - i / 40))
            d.ellipse([tx - 3, ty - 3, tx + 3, ty + 3], fill=(40, 80 + c // 2, 120 + c))
        glow(img, ex, ey, 30, (80, 150, 255), 0.7)
        d.ellipse([ex - 16, ey - 16, ex + 16, ey + 16], fill=(70, 140, 230))
        moon_a = clamp01(1 - (t - vanish) / 0.5)
        if moon_a > 0:
            ma = t * 2.6
            mx, my = ex + 60 * math.cos(ma), ey + 60 * 0.6 * math.sin(ma)
            d.ellipse([mx - 7, my - 7, mx + 7, my + 7], fill=mix(BG_MID, (210, 210, 215), moon_a))
        text(img, (W / 2, 90), "太陽のまわりを回る地球", font(56, "Bold"), INK, eo(window(t, 0, 0.8)), "mt")
        k = eo(window(t, vanish + 0.6, vanish + 1.6))
        text(img, (W / 2, SAFE_Y), "月が消えても、公転の道筋はほぼ同じ", font(48, "Black"), AMBER, k, "mm")
        note(img, "（地球の速さの変化は 0.04% 程度）", k)
        text(img, (ex + 30, ey - 40), "地球", font(30, "Bold"), INK, 1, "lm")
        return img


class LogScale(Renderer):
    def frame(self, t):
        p = self.p
        move = eio(window(t, 1.6, self.T * 0.7))
        cur = math.exp(math.log(p["points"][0]["value"]) * (1 - move) + math.log(p["points"][1]["value"]) * move)
        bright = clamp01((math.log10(cur) + 3.2) / 2.8) if p.get("dim") else 0.0
        top = mix((5, 9, 20), (40, 60, 105), bright)
        img = background(top, mix((14, 22, 44), (60, 80, 120), bright))
        self.stars.draw(ImageDraw.Draw(img), t, (4, 0), alpha=1 - 0.7 * bright)
        if p.get("dim"):
            glow(img, 1650, 230, 90, (230, 230, 240), bright * 0.9)
            ImageDraw.Draw(img).ellipse([1610, 190, 1690, 270], fill=mix(top, (235, 235, 240), bright))
        d = ImageDraw.Draw(img)
        title_bar(img, p.get("title", ""), t)
        lo, hi = math.log10(p["min"]), math.log10(p["max"])
        x0, x1, y = 200, W - 200, 640
        X = lambda v: x0 + (math.log10(v) - lo) / (hi - lo) * (x1 - x0)
        d.line([(x0, y), (x1, y)], fill=GRID, width=6)
        for e in range(int(math.floor(lo)), int(math.ceil(hi)) + 1):
            x = x0 + (e - lo) / (hi - lo) * (x1 - x0)
            d.line([(x, y - 18), (x, y + 18)], fill=MUTED, width=3)
            text(img, (x, y + 50), f"{10 ** e:g} {p['unit']}", font(28, "Regular"), MUTED, 1, "mm")
        for i, pt in enumerate(p["points"]):
            k = eo(window(t, 0.4 + i * 0.5, 1.2 + i * 0.5))
            x = X(pt["value"])
            col = [AMBER, CYAN][i % 2]
            d.ellipse([x - 14 * k, y - 14 * k, x + 14 * k, y + 14 * k], outline=col, width=4)
            text(img, (x, y - 120 + i * 0), f"{pt['label']}", font(40, "Bold"), col, k, "mm")
            text(img, (x, y - 72), f"約{pt['value']:g} {p['unit']}", font(34, "Regular"), INK, k, "mm")
        cx = X(cur)
        glow(img, cx, y, 40, (255, 255, 255), 0.7)
        ImageDraw.Draw(img).ellipse([cx - 16, y - 16, cx + 16, y + 16], fill=INK)
        note(img, "対数目盛 — 1目盛りで明るさ10倍", 1)
        return img


class NightSky(Renderer):
    stars_n = 900

    def __init__(self, p, T):
        super().__init__(p, T)
        rng = np.random.default_rng(11)
        mw = np.zeros((H, W), np.float32)
        yy, xx = np.mgrid[0:H, 0:W]
        band = np.exp(-((yy - (0.9 * xx * 0.55 - 80)) / 170.0) ** 2)
        g = rng.random((H // 24 + 2, W // 24 + 2)).astype(np.float32)
        n = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((W + 48, H + 48), Image.BICUBIC)
                       .filter(ImageFilter.GaussianBlur(10)), np.float32)[:H, :W] / 255
        mw = band * (0.5 + 0.8 * n) * float(p.get("milky_way", 0.6))
        self.mw = np.clip(mw, 0, 1)
        r = random.Random(5)
        pts = [(0, H)]
        x = 0
        while x < W:
            hgt = r.uniform(60, 190) if p.get("forest") else r.uniform(20, 50)
            w = r.uniform(18, 46)
            pts += [(x, H - 90), (x + w / 2, H - 90 - hgt), (x + w, H - 90)]
            x += w * r.uniform(0.5, 0.9)
        pts += [(W, H - 90), (W, H)]
        self.ground = pts

    def frame(self, t):
        arr = _gradient((3, 6, 16), (12, 18, 36)).astype(np.float32)
        arr += self.mw[..., None] * np.array([70, 70, 85], np.float32)
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        d = ImageDraw.Draw(img)
        self.stars.draw(d, t, (3, 0.8), rot=0.0)
        if self.p.get("city_glow"):
            glow(img, W * 0.82, H - 80, 260, (255, 140, 60), 0.5)
        d = ImageDraw.Draw(img)
        d.polygon(self.ground, fill=(2, 4, 8))
        if self.p.get("beetle_path"):
            k = window(t, 0.8, self.T - 0.5)
            x0, y0 = 300, H - 150
            x1 = x0 + 1300 * k
            d.line([(x0, y0), (x1, y0 - 300 * k)], fill=(110, 140, 190), width=3)
            glow(img, x1, y0 - 300 * k, 18, (200, 220, 255), 0.9)
            text(img, (x0, SAFE_Y), "天の川を目印に、まっすぐ進む", font(40, "Bold"), INK, eo(window(t, 1, 2)), "lm")
        return img


class Particles(Renderer):
    def __init__(self, p, T):
        super().__init__(p, T)
        r = random.Random(13)
        n = int(260 * float(p.get("density", 1.0))) + 6
        self.parts = [(r.uniform(0, W), r.uniform(0, H * 1.4), r.uniform(18, 55), r.uniform(3, 7), r.uniform(0, 6.28),
                       r.choice([(255, 150, 160), (255, 175, 110), (255, 200, 180)])) for _ in range(n)]
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        self.rays = [(np.exp(-((xx - (cx + (yy * 0.25))) / 60.0) ** 2) * np.clip(1 - yy / H, 0, 1)) for cx in (300, 820, 1350)]

    def frame(self, t):
        arr = _gradient((10, 40, 70), (2, 8, 20)).astype(np.float32)
        for i, ray in enumerate(self.rays):
            arr += ray[..., None] * np.array([30, 60, 80]) * (0.5 + 0.5 * math.sin(t * 0.6 + i * 2.1))
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        d = ImageDraw.Draw(img)
        for x, y, sp, sz, ph, col in self.parts:
            yy = (y - sp * t) % (H * 1.4) - H * 0.2
            xx = x + 14 * math.sin(ph + t * 0.8)
            d.ellipse([xx - sz, yy - sz, xx + sz, yy + sz], fill=col)
        if self.p.get("moon_phase"):
            k = eo(window(t, 0.6, 1.5))
            glow(img, 1680, 200, 80, (220, 225, 255), 0.8 * k)
            d.ellipse([1640, 160, 1720, 240], fill=mix((10, 40, 70), (235, 235, 240), k))
        text(img, (W / 2, SAFE_Y), self.p.get("label", ""), font(48, "Bold"), INK, eo(window(t, 0.8, 1.8)), "mm", stroke=2)
        return img


class TideSection(Renderer):
    """Shore cross-section; water level rises and falls. shrink: amplitude drops to ~1/3."""

    def frame(self, t):
        img = background((40, 70, 120), (110, 150, 190))
        d = ImageDraw.Draw(img)
        mode = self.p.get("mode", "shrink")
        P = 4.5
        a0 = 150
        change = window(t, self.T * 0.35, self.T * 0.6)
        amp = a0 * (1 - (2 / 3) * eio(change))
        mean = 640
        level = mean - amp * math.sin(2 * math.pi * t / P)
        shore = [(0, 330), (520, 470), (1100, 760), (W, 900), (W, H), (0, H)]
        wave = [(x, level + 6 * math.sin(x / 60 + t * 3)) for x in range(0, W + 40, 40)]
        d.polygon(wave + [(W, H), (0, H)], fill=(20, 70, 130))
        d.polygon(shore, fill=(120, 100, 75))

        def shore_x(yv):  # x where the shore line reaches height yv (on segment 520→1100)
            return 520 + (yv - 470) / (760 - 470) * (1100 - 520)

        hi_now, lo_now = mean - amp, mean + amp
        hi0, lo0 = mean - a0, mean + a0
        for yv, label, col in ((hi0, "以前の満潮", (200, 200, 210)), (lo0, "以前の干潮", (200, 200, 210))):
            xs = shore_x(yv)
            for x in range(int(xs), W, 26):
                d.line([(x, yv), (x + 13, yv)], fill=col, width=2)
            text(img, (W - 40, yv - 26), label, font(28, "Regular"), (220, 225, 235), 1, "rm")
        if mode == "intertidal":
            band = [(shore_x(hi_now), hi_now), (shore_x(lo_now), lo_now)]
            d.line(band, fill=GREEN, width=16)
            text(img, (band[0][0] - 30, (hi_now + lo_now) / 2), "潮間帯", font(44, "Black"), GREEN, 1, "rm", stroke=2)
        text(img, (W / 2, 70), "潮の満ち引き（断面図）", font(56, "Bold"), INK, eo(window(t, 0, 0.8)), "mt", stroke=2)
        k = eo(window(t, self.T * 0.6, self.T * 0.6 + 1))
        msg = "太陽だけの潮：いつもの約3分の1" if mode == "shrink" else "潮が弱まると、潮間帯は細くなる"
        text(img, (W / 2, 170), msg, font(48, "Black"), AMBER, k, "mt", stroke=2)
        return img


class Sea(Renderer):
    def frame(self, t):
        img = background((30, 40, 80), (220, 140, 110))
        glow(img, W * 0.62, 600, 160, (255, 200, 140), 0.8)
        d = ImageDraw.Draw(img)
        for layer in range(7):
            y0 = 600 + layer * 70
            amp = 4 + layer * 3
            speed = 0.4 + layer * 0.25
            pts = [(x, y0 + amp * math.sin(x / (90 + layer * 30) + t * speed + layer)) for x in range(0, W + 30, 30)]
            c = mix((40, 50, 90), (8, 20, 45), layer / 6)
            d.polygon(pts + [(W, H), (0, H)], fill=c)
            for x in range(0, W, 140):
                xx = (x + t * 30 * (layer + 1)) % W
                if abs(xx - W * 0.62) < 300:
                    yy = y0 + amp * math.sin(xx / (90 + layer * 30) + t * speed + layer)
                    d.line([(xx - 20, yy), (xx + 20, yy)], fill=(255, 210, 160), width=2)
        text(img, (W / 2, 120), "巨大津波は起きない", font(60, "Black"), INK, eo(window(t, 0.5, 1.5)), "mt", stroke=2)
        text(img, (W / 2, 210), "外洋の潮の盛り上がりは1メートル未満", font(40, "Regular"), INK, eo(window(t, 1.2, 2.2)), "mt", stroke=2)
        return img


class SpringNeap(Renderer):
    def frame(self, t):
        img = self.base(t, (2, 0))
        d = ImageDraw.Draw(img)
        sx, sy = 260, H / 2 - 20
        glow(img, sx, sy, 140, (255, 190, 90), 0.9)
        d.ellipse([sx - 70, sy - 70, sx + 70, sy + 70], fill=(255, 220, 140))
        ex, ey = 1180, H / 2 - 20
        gone = window(t, self.T * 0.62, self.T * 0.62 + 0.8)
        ma = t * 2 * math.pi / 6.0
        lun = 1.0 * (1 - gone)
        sol = 0.46
        # tidal bulge: add components as vectors at double angle
        vx = lun * math.cos(2 * ma) + sol * math.cos(2 * math.pi)
        vy = lun * math.sin(2 * ma) + sol * math.sin(2 * math.pi)
        mag = math.hypot(vx, vy)
        ang = math.atan2(vy, vx) / 2
        R = 110
        a_ax, b_ax = R + 55 * mag, R - 10 * mag
        poly = []
        for i in range(60):
            th = i / 60 * 2 * math.pi
            x, y = a_ax * math.cos(th), b_ax * math.sin(th)
            poly.append((ex + x * math.cos(ang) - y * math.sin(ang), ey + x * math.sin(ang) + y * math.cos(ang)))
        d.polygon(poly, fill=(40, 110, 200))
        paste_globe(img, ex, ey, R, spin=t * 0.3, tilt=0, sun=(-1, 0, 0.35), atmosphere=False)
        d = ImageDraw.Draw(img)
        if gone < 1:
            mx, my = ex + 270 * math.cos(ma), ey + 230 * math.sin(ma)
            d.ellipse([mx - 28, my - 28, mx + 28, my + 28], fill=mix(BG_MID, (210, 210, 215), 1 - gone))
        align = abs(math.cos(ma))
        text(img, (W / 2, 70), "大潮と小潮", font(56, "Bold"), INK, eo(window(t, 0, 0.8)), "mt")
        if gone < 0.5:
            label = "大潮：太陽と月が一直線" if align > 0.8 else "小潮：太陽と月が直角" if align < 0.3 else ""
            text(img, (W / 2, 165), label, font(46, "Black"), AMBER, 1, "mm")
        else:
            text(img, (W / 2, 165), "月がない：太陽の潮だけ（毎日ほぼ同じ）", font(46, "Black"), AMBER, eo(window(t, self.T * 0.62 + 0.6, self.T * 0.62 + 1.6)), "mm")
        text(img, (sx, sy + 120), "太陽", font(32, "Regular"), MUTED, 1, "mt")
        note(img, "海の盛り上がりは誇張して表示", 1)
        return img


class NumberCards(Renderer):
    def frame(self, t):
        img = self.base(t)
        d = ImageDraw.Draw(img)
        cards = self.p["cards"]
        cw, ch, gap = 720, 420, 120
        x = (W - (cw * len(cards) + gap * (len(cards) - 1))) / 2
        for i, c in enumerate(cards):
            k = eo(window(t, 0.3 + i * 0.5, 1.1 + i * 0.5))
            col = [CYAN, AMBER][i % 2]
            yoff = 40 * (1 - k)
            d.rounded_rectangle([x, 330 + yoff, x + cw, 330 + ch + yoff], 28, outline=mix(BG_MID, col, k), width=5, fill=(14, 24, 46))
            val = count_text(c["value"], window(t, 0.6 + i * 0.5, 2.2 + i * 0.5))
            text(img, (x + cw / 2, 480 + yoff), val, font(120, "Black"), col, k, "mm")
            text(img, (x + cw / 2, 640 + yoff), c["label"], font(40, "Regular"), INK, k, "mm")
            x += cw + gap
        return img


class Globe(Renderer):
    def frame(self, t):
        p = self.p
        img = self.base(t, (2, 0))
        dark = 0.75 if p.get("dark") else 0.0
        sun = (0.95, 0.1, -0.3) if p.get("dark") else (-0.8, 0.2, 0.55)
        r = 320 if not p.get("dark") else 330 + 20 * eo(t / self.T)
        paste_globe(img, W / 2, H / 2 - 50, int(r), spin=t * 0.25, tilt=p.get("tilt", 23.4), sun=sun, dark=dark * 0.2)
        if p.get("label"):
            text(img, (W / 2, SAFE_Y), p["label"], font(48, "Bold"), INK, eo(window(t, 0.8, 1.8)), "mm", stroke=2)
        return img


class Tilt(Renderer):
    def frame(self, t):
        p = self.p
        img = self.base(t, (2, 0))
        cx, cy, R = W / 2 - 200, H / 2 - 30, 270
        paste_globe(img, cx, cy, R, spin=t * 0.35, tilt=p["angle"])
        d = ImageDraw.Draw(img)
        a = math.radians(p["angle"])
        L = R + 90
        k = eo(window(t, 0.6, 1.6))
        for yy in range(int(cy - L), int(cy + L), 24):
            d.line([(cx, yy), (cx, yy + 12)], fill=MUTED, width=2)
        dx, dy = math.sin(a) * L * k, math.cos(a) * L * k
        d.line([(cx - dx, cy + dy), (cx + dx, cy - dy)], fill=AMBER, width=8)
        text(img, (cx + dx + 20, cy - dy), f"{p['angle']}°", font(48, "Black"), AMBER, k, "lm")
        title_bar(img, p.get("title", ""), t)
        text(img, (1250, 560), p.get("caption", ""), font(46, "Bold"), INK, eo(window(t, 1.4, 2.4)), "lm")
        return img


class RangeCompare(Renderer):
    def __init__(self, p, T):
        super().__init__(p, T)
        self.walks = []
        for i, r in enumerate(p["ranges"]):
            rng = np.random.default_rng(20 + i)
            steps = rng.normal(0, 1, 2000).cumsum()
            steps = (steps - steps.min()) / (steps.max() - steps.min() + 1e-9)
            self.walks.append(steps)

    def frame(self, t):
        p = self.p
        img = self.base(t)
        d = ImageDraw.Draw(img)
        title_bar(img, p.get("title", ""), t)
        vmin, vmax = p["min"], p["max"]
        x0, x1 = 600, W - 160
        X = lambda v: x0 + (v - vmin) / (vmax - vmin) * (x1 - x0)
        ys = [330 + i * 210 for i in range(len(p["ranges"]))]
        axis_y = ys[-1] + 150
        d.line([(x0, axis_y), (x1, axis_y)], fill=GRID, width=4)
        for v in range(int(vmin), int(vmax) + 1, 15):
            d.line([(X(v), axis_y - 12), (X(v), axis_y + 12)], fill=MUTED, width=3)
            text(img, (X(v), axis_y + 40), f"{v}{p['unit']}", font(30, "Regular"), MUTED, 1, "mm")
        if p.get("marker") is not None:
            mx = X(p["marker"])
            for yy in range(260, axis_y, 22):
                d.line([(mx, yy), (mx, yy + 11)], fill=INK, width=2)
            text(img, (mx + 10, 250), f"現在 {p['marker']}{p['unit']}", font(28, "Regular"), INK, 1, "lm")
        for i, (r, y) in enumerate(zip(p["ranges"], ys)):
            col = [CYAN, RED, AMBER][i % 3]
            k = eo(window(t, 0.5 + i * 0.8, 1.6 + i * 0.8))
            text(img, (x0 - 30, y + 40), r["label"], font(38, "Bold"), INK, k, "rm")
            lo_x = X(r["lo"])
            hi_x = max(lo_x + 12, lo_x + (X(r["hi"]) - lo_x) * k)
            if k > 0:
                d.rounded_rectangle([lo_x, y, hi_x, y + 80], 12, fill=mix(BG_MID, col, 0.75))
            inside = X(r["hi"]) + 420 >= W
            tx = lo_x + 20 if inside else X(r["hi"]) + 20
            text(img, (tx, y + 40), r.get("text", ""), font(40, "Black"), (5, 9, 20) if inside else INK, k, "lm")
            if r.get("wander") and k >= 1:
                wk = self.walks[i]
                speed = 120 if r.get("chaos") else 40
                idx = (t * speed) % (len(wk) - 1)
                f = wk[int(idx)] * (1 - idx % 1) + wk[int(idx) + 1] * (idx % 1)
                v = r["lo"] + (r["hi"] - r["lo"]) * f
                mxp = X(v)
                glow(img, mxp, y + 40, 26, (255, 255, 255), 0.8)
                ImageDraw.Draw(img).ellipse([mxp - 12, y + 28, mxp + 12, y + 52], fill=INK)
        if p.get("footnote"):
            note(img, p["footnote"], 1)
        return img


class Precession(Renderer):
    def frame(self, t):
        p = self.p
        img = self.base(t, (2, 0))
        cx, cy, R = 640, H / 2 + 10, 240
        wob = t * 2 * math.pi / 8.0
        L = R + 110
        top_y = cy - L * math.cos(math.radians(23.4))
        rx = L * math.sin(math.radians(23.4))
        tipx, tipy = cx + rx * math.cos(wob), top_y + rx * 0.25 * math.sin(wob)
        tilt = math.degrees(math.atan2(tipx - cx, cy - tipy))
        paste_globe(img, cx, cy, R, spin=t * 0.5, tilt=tilt)
        d = ImageDraw.Draw(img)
        d.ellipse([cx - rx, top_y - rx * 0.25, cx + rx, top_y + rx * 0.25], outline=(120, 140, 180), width=2)
        d.line([(2 * cx - tipx, 2 * cy - tipy), (tipx, tipy)], fill=AMBER, width=7)
        glow(img, tipx, tipy, 18, AMBER, 0.9)
        title_bar(img, p.get("title", ""), t)
        # pie
        px, py, pr = 1450, 560, 210
        k = eo(window(t, 1.0, 2.6))
        share = p.get("moon_share", 2 / 3)
        d.pieslice([px - pr, py - pr, px + pr, py + pr], -90, -90 + 360 * share * k, fill=CYAN)
        d.pieslice([px - pr, py - pr, px + pr, py + pr], -90 + 360 * share * k, -90 + 360 * k, fill=AMBER)
        text(img, (px, py + pr + 60), "月 約3分の2", font(44, "Black"), CYAN, k, "mm")
        text(img, (px, py + pr + 120), "太陽 約3分の1", font(36, "Bold"), AMBER, k, "mm")
        note(img, p.get("caption", ""), k)
        return img


class SolarSystem(Renderer):
    PL = [("水星", 110, 4.1, 7, (180, 170, 160)), ("金星", 170, 1.6, 11, (230, 200, 150)),
          ("地球", 240, 1.0, 12, (80, 150, 240)), ("火星", 320, 0.53, 9, (220, 120, 80)),
          ("木星", 470, 0.084 * 3, 26, (220, 190, 150))]

    def frame(self, t):
        img = self.base(t, (2, 0))
        d = ImageDraw.Draw(img)
        cx, cy = W / 2, H / 2 + 40
        glow(img, cx, cy, 70, (255, 190, 90), 0.9)
        d.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], fill=(255, 220, 140))
        pos = {}
        for name, r, sp, sz, col in self.PL:
            d.ellipse([cx - r, cy - r * 0.45, cx + r, cy + r * 0.45], outline=(60, 75, 110), width=2)
            a = t * sp * 0.5 + r
            x, y = cx + r * math.cos(a), cy + r * 0.45 * math.sin(a)
            pos[name] = (x, y)
            d.ellipse([x - sz, y - sz, x + sz, y + sz], fill=col)
            text(img, (x, y - sz - 8), name, font(26, "Regular"), MUTED, 1, "mb")
        pulse = (t % 2.5) / 2.5
        ex, ey = pos["地球"]
        for src in ("木星", "金星"):
            sx, sy = pos[src]
            px, py = sx + (ex - sx) * pulse, sy + (ey - sy) * pulse
            glow(img, px, py, 14, (255, 255, 255), 0.6 * (1 - pulse))
        text(img, (W / 2, 70), "ほかの惑星も、地球を少しずつ引っ張っている", font(52, "Bold"), INK, eo(window(t, 0.3, 1.2)), "mt")
        note(img, "軌道の大きさ・速さは見やすく調整", 1)
        return img


class Seasons(Renderer):
    def frame(self, t):
        p = self.p
        img = self.base(t, (2, 0))
        d = ImageDraw.Draw(img)
        cx, cy, R = W / 2, H / 2 - 30, 560
        glow(img, cx, cy, 110, (255, 190, 90), 0.9)
        d.ellipse([cx - 50, cy - 50, cx + 50, cy + 50], fill=(255, 220, 140))
        d.ellipse([cx - R, cy - R * 0.32, cx + R, cy + R * 0.32], outline=(70, 90, 130), width=2)
        ang = t * 2 * math.pi / max(8.0, self.T * 0.9) + math.pi
        ex, ey = cx + R * math.cos(ang), cy + R * 0.32 * math.sin(ang)
        to_sun = (cx - ex, cy - ey)
        n = math.hypot(*to_sun)
        sun = (to_sun[0] / n, -to_sun[1] / n * 0.3, 0.35)
        paste_globe(img, ex, ey, 110, spin=t * 1.2, tilt=p["tilt"], sun=sun)
        d = ImageDraw.Draw(img)
        a = math.radians(p["tilt"])
        L = 170
        d.line([(ex - math.sin(a) * L, ey + math.cos(a) * L), (ex + math.sin(a) * L, ey - math.cos(a) * L)], fill=AMBER, width=5)
        text(img, (W / 2, 70), f"もし傾きが {p['tilt']}° になったら", font(56, "Bold"), INK, eo(window(t, 0, 0.8)), "mt")
        # the north end of the axis points to screen-right; it faces the Sun when Earth is left of the Sun
        side = math.cos(ang)
        msg = ("北極が太陽を向く → 北半球は何か月も沈まない太陽" if side < -0.6 else
               "南極が太陽を向く → 北半球は何か月も夜" if side > 0.6 else "")
        text(img, (W / 2, SAFE_Y), msg, font(44, "Black"), AMBER, 1, "mm")
        return img


class ClimateBands(Renderer):
    def __init__(self, p, T):
        super().__init__(p, T)
        tex = earth_texture()
        self.map = Image.fromarray(tex.astype(np.uint8)).resize((1600, 800))

    def frame(self, t):
        img = background()
        x0, y0, mw, mh = 310, 200, 1300, 650
        img.paste(self.map.resize((mw, mh)), (x0, y0))
        d = ImageDraw.Draw(img, "RGBA")
        seq = [23.4, 43.4, 13.4, 33.4, 23.4]
        u = (t / self.T) * (len(seq) - 1)
        i = min(int(u), len(seq) - 2)
        tilt = seq[i] + (seq[i + 1] - seq[i]) * eio(u - i)
        Y = lambda lat: y0 + (90 - lat) / 180 * mh
        d.rectangle([x0, Y(tilt), x0 + mw, Y(-tilt)], fill=(255, 120, 60, 70))
        d.rectangle([x0, y0, x0 + mw, Y(90 - tilt)], fill=(200, 230, 255, 90))
        d.rectangle([x0, Y(-(90 - tilt)), x0 + mw, y0 + mh], fill=(200, 230, 255, 90))
        for lat in (tilt, -tilt, 90 - tilt, -(90 - tilt)):
            d.line([(x0, Y(lat)), (x0 + mw, Y(lat))], fill=(255, 255, 255, 200), width=3)
        text(img, (x0 + 20, Y(0)), "熱帯（太陽が真上に来る範囲）", font(36, "Black"), INK, 1, "lm", stroke=2)
        text(img, (x0 + 20, Y(90 - tilt) - 40), "白夜・極夜がある範囲", font(32, "Bold"), INK, 1, "lm", stroke=2)
        text(img, (W / 2, 70), f"地軸の傾き {tilt:.1f}°", font(64, "Black"), AMBER, 1, "mt")
        text(img, (W / 2, 150), "傾きが変わると、気候の帯が動く", font(40, "Regular"), INK, eo(window(t, 0.5, 1.5)), "mt")
        return img


class Pending(Renderer):
    """Animatic stand-in for an AI shot that has not been generated yet (clearly labelled, still moving)."""

    def frame(self, t):
        img = self.base(t, (25, 4))
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, W, 100], fill=(150, 30, 40))
        text(img, (W / 2, 50), "下書き — AI動画 生成待ち — 公開不可", font(48, "Black"), INK, 1, "mm")
        text(img, (W / 2, 430), self.p.get("cut", ""), font(90, "Black"), INK, 1, "mm")
        text(img, (W / 2, 560), self.p.get("purpose", ""), font(56, "Bold"), AMBER, 1, "mm")
        prompt = self.p.get("prompt", "")
        for i in range(0, min(len(prompt), 300), 100):
            text(img, (W / 2, 680 + i // 100 * 46), prompt[i:i + 100], font(28, "Regular"), MUTED, 1, "mm")
        r = 40 + 10 * math.sin(t * 3)
        d.arc([W / 2 - r, 230 - r, W / 2 + r, 230 + r], (t * 200) % 360, (t * 200) % 360 + 270, fill=CYAN, width=6)
        return img


RENDERERS = {
    "pending": Pending,
    "title": Title, "legend": Legend, "timeline": Timeline, "barycenter": Barycenter, "bar_compare": BarCompare,
    "orbit": Orbit, "log_scale": LogScale, "night_sky": NightSky, "particles": Particles,
    "tide_section": TideSection, "sea": Sea, "spring_neap": SpringNeap, "number_cards": NumberCards,
    "globe": Globe, "tilt": Tilt, "range_compare": RangeCompare, "precession": Precession,
    "solar_system": SolarSystem, "seasons": Seasons, "climate_bands": ClimateBands,
}


def render_clip(spec: dict, frames: int, out: Path, *, fps: int = 30, crf: int = 18,
                fade_in: bool = False, fade_out: bool = False) -> Path:
    kind = spec["type"]
    if kind not in RENDERERS:
        raise PipelineError(f"unknown motion type '{kind}' (known: {', '.join(RENDERERS)})")
    T = frames / fps
    r = RENDERERS[kind](spec.get("params", {}), T)
    vf = []
    if fade_in:
        vf.append("fade=t=in:st=0:d=0.35")
    if fade_out:
        vf.append(f"fade=t=out:st={max(0.0, T - 0.35):.3f}:d=0.35")
    vf.append("format=yuv420p")
    out.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                             "-r", str(fps), "-i", "-", "-vf", ",".join(vf), "-c:v", "libx264", "-preset", "veryfast",
                             "-crf", str(crf), "-r", str(fps), str(out)], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for i in range(frames):
            proc.stdin.write(r.frame(i / fps).convert("RGB").tobytes())
        proc.stdin.close()
    except BrokenPipeError:
        pass
    if proc.wait() != 0:
        raise PipelineError(f"ffmpeg failed rendering motion '{kind}': {proc.stderr.read().decode()[-800:]}")
    return out


def still(spec: dict, t: float, T: float = 10.0) -> Image.Image:
    """One frame (for previews and tests)."""
    return RENDERERS[spec["type"]](spec.get("params", {}), T).frame(t)
