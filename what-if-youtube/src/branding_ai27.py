"""Channel artwork for 「AIでつくる、27歳の記録」: icon (800×800) and banner (2560×1440).

    python -m src.branding_ai27            → branding/ai27/icon_options.png (three icon ideas, circle-cropped)
    python -m src.branding_ai27 --pick B   → branding/ai27/icon.png, banner.png and previews in that style

The marks describe the channel, not any one episode: a person typing to an AI, and keeping a record.
Palette is deliberately different from What If Lab's night-sky navy: deep green + paper white + amber.
"""
from __future__ import annotations

import argparse
import math

from PIL import Image, ImageDraw, ImageFilter

from . import motion
from .common import ROOT

OUT = ROOT / "branding" / "ai27"
NAME = "AIでつくる、27歳の記録"
TAGLINE = "プログラミング経験ゼロの会社員が、AIで動画をつくる。"
SUBLINE = "費用・失敗・再生数、ぜんぶ記録します"
GREEN = (31, 77, 67)
GREEN_D = (20, 52, 45)
PAPER = (246, 243, 234)
AMBER = (240, 170, 60)
INK = (24, 30, 28)


def _bg(S: int) -> Image.Image:
    img = Image.new("RGB", (S, S), GREEN)
    g = Image.new("L", (S, S), 0)
    ImageDraw.Draw(g).ellipse([-S * 0.2, -S * 0.3, S * 0.9, S * 0.7], fill=60)
    g = g.filter(ImageFilter.GaussianBlur(S / 6))
    img.paste(Image.new("RGB", (S, S), (52, 110, 96)), (0, 0), g)
    return img


def _sparkle(d: ImageDraw.ImageDraw, cx, cy, r, color):
    k = r * 0.22
    d.polygon([(cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k), (cx, cy + r), (cx - k, cy + k),
               (cx - r, cy), (cx - k, cy - k)], fill=color)


def mark_cursor(S: int) -> Image.Image:
    """A: 「27」 being typed — a text cursor after it, and a small AI sparkle."""
    img = _bg(S)
    d = ImageDraw.Draw(img)
    f = motion.font(int(S * 0.42), "Black")
    w = d.textlength("27", font=f)
    x = S / 2 - (w + S * 0.11) / 2
    d.text((x, S * 0.52), "27", font=f, fill=PAPER, anchor="lm")
    cx0 = x + w + S * 0.03
    d.rectangle([cx0, S * 0.36, cx0 + S * 0.07, S * 0.68], fill=AMBER)
    _sparkle(d, S * 0.73, S * 0.27, S * 0.07, AMBER)
    _sparkle(d, S * 0.80, S * 0.37, S * 0.035, PAPER)
    return img


def mark_bubble(S: int) -> Image.Image:
    """B: a chat bubble (asking the AI) holding a rising record bar chart."""
    img = _bg(S)
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = S * 0.2, S * 0.24, S * 0.8, S * 0.68
    d.rounded_rectangle([x0, y0, x1, y1], radius=int(S * 0.08), fill=PAPER)
    d.polygon([(S * 0.3, y1 - 2), (S * 0.42, y1 - 2), (S * 0.27, S * 0.8)], fill=PAPER)
    bars = [0.25, 0.42, 0.6, 0.85]
    bw = (x1 - x0 - S * 0.16) / (len(bars) * 1.6)
    for i, h in enumerate(bars):
        bx = x0 + S * 0.08 + i * bw * 1.6
        top = y1 - S * 0.07 - (y1 - y0 - S * 0.16) * h
        d.rounded_rectangle([bx, top, bx + bw, y1 - S * 0.07], radius=int(bw * 0.25),
                            fill=AMBER if i == len(bars) - 1 else GREEN)
    _sparkle(d, S * 0.75, S * 0.2, S * 0.06, AMBER)
    return img


def mark_stamp(S: int) -> Image.Image:
    """C: a ledger seal — the channel name around the rim, 「27」 in the middle."""
    img = _bg(S)
    d = ImageDraw.Draw(img)
    cx = cy = S / 2
    R = S * 0.36
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=PAPER, width=int(S * 0.018))
    r2 = R * 0.72
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], outline=PAPER, width=int(S * 0.008))
    f = motion.font(int(S * 0.058), "Bold")
    rr = (R + r2) / 2

    def arc(text, a0, a1, bottom):
        n = len(text)
        for i, ch in enumerate(text):
            a = math.radians(a0 + (a1 - a0) * (i + 0.5) / n)
            tile = Image.new("RGBA", (int(S * 0.09), int(S * 0.09)), (0, 0, 0, 0))
            ImageDraw.Draw(tile).text((tile.width / 2, tile.height / 2), ch, font=f, fill=PAPER, anchor="mm")
            rot = -math.degrees(a) - 90 if not bottom else -math.degrees(a) + 90
            tile = tile.rotate(rot, resample=Image.BICUBIC)
            img.paste(tile, (int(cx + rr * math.cos(a) - tile.width / 2), int(cy + rr * math.sin(a) - tile.height / 2)), tile)

    arc("AIでつくる", -150, -30, False)   # top arc, read left to right
    arc("27歳の記録", 150, 30, True)      # bottom arc, also left to right and upright
    for a in (180, 0):
        x, y = cx + rr * math.cos(math.radians(a)), cy + rr * math.sin(math.radians(a))
        d.ellipse([x - S * 0.01, y - S * 0.01, x + S * 0.01, y + S * 0.01], fill=AMBER)
    d.text((cx, cy + S * 0.01), "27", font=motion.font(int(S * 0.24), "Black"), fill=AMBER, anchor="mm")
    return img


MARKS = {"A": ("A：入力中の27", mark_cursor), "B": ("B：吹き出しと記録", mark_bubble), "C": ("C：記録のハンコ", mark_stamp)}


def _circle(img: Image.Image) -> Image.Image:
    S = img.width
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).ellipse([0, 0, S, S], fill=255)
    out = Image.new("RGB", (S, S), (255, 255, 255))
    out.paste(img, (0, 0), m)
    return out


def options() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    S, pad = 400, 40
    sheet = Image.new("RGB", (len(MARKS) * (S + pad) + pad, S + pad * 2 + 110 + 60), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for i, (k, (label, fn)) in enumerate(MARKS.items()):
        big = fn(800)
        big.save(OUT / f"icon_option_{k}.png")
        x = pad + i * (S + pad)
        sheet.paste(_circle(big.resize((S, S), Image.LANCZOS)), (x, pad))
        sheet.paste(_circle(big.resize((48, 48), Image.LANCZOS)), (x + S // 2 - 24, pad + S + 20))
        d.text((x + S / 2, pad + S + 110), label, font=motion.font(30, "Bold"), fill=INK, anchor="mm")
    d.text((pad, sheet.height - 40), "下の小さい丸＝コメント欄などで実際に表示される大きさ", font=motion.font(22, "Regular"), fill=(110, 110, 110))
    sheet.save(OUT / "icon_options.png")


def banner(fn) -> Image.Image:
    W, H = 2560, 1440
    img = Image.new("RGB", (W, H), GREEN)
    g = Image.new("L", (W, H), 0)
    ImageDraw.Draw(g).ellipse([W * 0.1, -H * 0.2, W * 0.7, H * 0.8], fill=50)
    img.paste(Image.new("RGB", (W, H), (52, 110, 96)), (0, 0), g.filter(ImageFilter.GaussianBlur(200)))
    d = ImageDraw.Draw(img)
    # faint ledger lines across the whole banner
    for y in range(0, H, 46):
        d.line([0, y, W, y], fill=(40, 88, 77), width=2)
    mark = _circle(fn(300)).convert("RGB")
    m = Image.new("L", (300, 300), 0)
    ImageDraw.Draw(m).ellipse([0, 0, 300, 300], fill=255)
    sx, sy = (W - 1546) // 2, (H - 423) // 2  # YouTube safe area
    img.paste(mark, (sx + 30, sy + 60), m)
    d.text((sx + 380, sy + 120), NAME, font=motion.font(104, "Black"), fill=PAPER, anchor="lm")
    d.text((sx + 384, sy + 250), TAGLINE, font=motion.font(46, "Bold"), fill=PAPER, anchor="lm")
    d.text((sx + 384, sy + 325), SUBLINE, font=motion.font(40, "Regular"), fill=AMBER, anchor="lm")
    return img


def build(pick: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    fn = MARKS[pick][1]
    fn(800).save(OUT / "icon.png")
    b = banner(fn)
    b.save(OUT / "banner.png")
    prev = b.resize((1280, 720), Image.LANCZOS)
    d = ImageDraw.Draw(prev)
    d.rectangle([(1280 - 773) / 2, (720 - 212) / 2, (1280 + 773) / 2, (720 + 212) / 2], outline=(255, 80, 80), width=2)
    prev.save(OUT / "preview_banner.png")
    _circle(fn(800).resize((400, 400), Image.LANCZOS)).save(OUT / "preview_icon.png")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pick", choices=list(MARKS))
    a = ap.parse_args()
    build(a.pick) if a.pick else options()
