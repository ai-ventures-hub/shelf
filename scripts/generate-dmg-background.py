#!/usr/bin/env python3
"""Render build/dmg-background.tiff (660x400 @1x + @2x, Suds dark style).

Requires Pillow and macOS tiffutil. The generated TIFF is committed so CI
never needs this script. Icon slots match the dmg config in package.json:
app icon centered at (180, 190), /Applications link at (480, 190).
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "dmg-background.tiff"

# Suds System Studio dark tokens (src/styles/tokens.css).
SURFACE = (9, 13, 22)
GLOW = (73, 98, 193)
INK = (246, 247, 251)
MUTED = (153, 163, 184)
SUBTLE = (111, 122, 145)
BRAND = (120, 149, 255)

FONT_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
]


def load_font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            # HelveticaNeue.ttc index 1 is Bold on current macOS.
            index = 1 if bold and path.endswith("HelveticaNeue.ttc") else 0
            try:
                return ImageFont.truetype(path, size, index=index)
            except OSError:
                continue
    return ImageFont.load_default()


def render(scale: int) -> Image.Image:
    w, h = 660 * scale, 400 * scale
    img = Image.new("RGB", (w, h), SURFACE)
    draw = ImageDraw.Draw(img)

    # Top-left radial glow, mirroring the app's surface wash.
    glow = Image.new("L", (w, h), 0)
    glow_draw = ImageDraw.Draw(glow)
    cx, cy, radius = int(w * 0.15), int(-h * 0.1), int(30 * 16 * scale * 0.6)
    for r in range(radius, 0, -2 * scale):
        alpha = int(46 * (1 - r / radius))
        glow_draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=alpha)
    tint = Image.new("RGB", (w, h), GLOW)
    img = Image.composite(tint, img, glow)
    draw = ImageDraw.Draw(img)

    # Wordmark, top-left.
    draw.text((36 * scale, 30 * scale), "Shelf", font=load_font(17 * scale, True), fill=INK)

    # Arrow between the icon slots (centers 180,190 and 480,190; icons 110pt).
    y = 190 * scale
    x0, x1 = 262 * scale, 396 * scale
    lw = max(3 * scale, 3)
    draw.line((x0, y, x1, y), fill=BRAND, width=lw)
    head = 13 * scale
    draw.polygon(
        [(x1 + head, y), (x1 - head // 2, y - head), (x1 - head // 2, y + head)],
        fill=BRAND,
    )

    # Caption under the icon row.
    caption = "Drag Shelf to Applications to install"
    font = load_font(15 * scale, False)
    tw = draw.textlength(caption, font=font)
    draw.text(((w - tw) / 2, 300 * scale), caption, font=font, fill=MUTED)

    sub = "Free · local-first · MIT"
    font_sub = load_font(11 * scale, False)
    tw = draw.textlength(sub, font=font_sub)
    draw.text(((w - tw) / 2, 330 * scale), sub, font=font_sub, fill=SUBTLE)

    return img


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        p1 = Path(tmp) / "bg.png"
        p2 = Path(tmp) / "bg@2x.png"
        render(1).save(p1)
        render(2).save(p2)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["tiffutil", "-cathidpicheck", str(p1), str(p2), "-out", str(OUT)],
            check=True,
        )
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
