#!/usr/bin/env python3
"""Render build/dmg-background.tiff (660x400 @1x + @2x, Brand Standard v1.0).

Requires Pillow and macOS tiffutil. The generated TIFF is committed so CI
never needs this script. Icon slots match the dmg config in package.json:
app icon centered at (180, 190), /Applications link at (480, 190), 110pt
icons. Finder draws the icon labels itself, so none are baked in.

Layout (matches the launch design): centered brand lockup + tagline up top,
dashed drop-zones around both icon slots, arrow between, caption + trust
line below.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "dmg-background.tiff"

# AI Ventures dark tokens + Brand Standard v1.0 mark values.
SURFACE = (9, 13, 22)
GLOW = (73, 98, 193)
INK = (246, 247, 251)
MUTED = (153, 163, 184)
SUBTLE = (111, 122, 145)
BRAND = (120, 149, 255)
DASH = (122, 139, 216)

MARK_GRAD_A = (154, 175, 255)  # #9aafff
MARK_GRAD_B = (82, 111, 221)  # #526fdd
MARK_INK = (8, 16, 33)  # #081021

ARCHIVO_XBOLD = ROOT / "site" / "assets" / "og" / "Archivo-ExtraBold.ttf"

FONT_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
]

# Geometry shared with package.json build.dmg.
ICON_CENTERS = ((180, 190), (480, 190))
ICON_SIZE = 110


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


def load_wordmark_font(size: int) -> ImageFont.FreeTypeFont:
    if ARCHIVO_XBOLD.exists():
        return ImageFont.truetype(str(ARCHIVO_XBOLD), size)
    return load_font(size, True)


def draw_mark(img: Image.Image, x: int, y: int, side: int) -> None:
    """Official mark: 145° gradient tile (22% radius) + ink bracket glyph.
    Drawn 4× oversized and downsampled for clean edges at small sizes."""
    out_side = side
    side = side * 4
    tile = Image.new("RGB", (side, side))
    px = tile.load()
    # Linear gradient along the 145° axis ≈ favicon's (10,10)→(90,90) run.
    for j in range(side):
        for i in range(side):
            k = min(1.0, max(0.0, (i + j) / (2 * side * 0.8) - 0.125))
            px[i, j] = tuple(
                int(a + (b - a) * k) for a, b in zip(MARK_GRAD_A, MARK_GRAD_B)
            )
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, side - 1, side - 1), radius=int(side * 0.22), fill=255
    )
    glyph = ImageDraw.Draw(tile)
    s = side / 100.0
    # M20 18h60v18H40v14H20V18z
    glyph.polygon(
        [(20 * s, 18 * s), (80 * s, 18 * s), (80 * s, 36 * s), (40 * s, 36 * s),
         (40 * s, 50 * s), (20 * s, 50 * s)],
        fill=MARK_INK,
    )
    # M20 82h60V50H58v14H20V82z
    glyph.polygon(
        [(20 * s, 82 * s), (80 * s, 82 * s), (80 * s, 50 * s), (58 * s, 50 * s),
         (58 * s, 64 * s), (20 * s, 64 * s)],
        fill=MARK_INK,
    )
    tile = tile.resize((out_side, out_side), Image.LANCZOS)
    mask = mask.resize((out_side, out_side), Image.LANCZOS)
    img.paste(tile, (x, y), mask)


def dashed_rounded_rect(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    radius: int,
    color: tuple[int, int, int],
    width: int,
    dash: int,
    gap: int,
) -> None:
    """Approximate a dashed rounded rect: dashes on the straight runs, solid
    short arcs at the corners."""
    x0, y0, x1, y1 = box

    def dashes(a: float, b: float):
        pos = a
        while pos < b:
            end = min(pos + dash, b)
            yield pos, end
            pos = end + gap

    for s, e in dashes(x0 + radius, x1 - radius):
        draw.line((s, y0, e, y0), fill=color, width=width)
        draw.line((s, y1, e, y1), fill=color, width=width)
    for s, e in dashes(y0 + radius, y1 - radius):
        draw.line((x0, s, x0, e), fill=color, width=width)
        draw.line((x1, s, x1, e), fill=color, width=width)
    d = radius * 2
    draw.arc((x0, y0, x0 + d, y0 + d), 180, 270, fill=color, width=width)
    draw.arc((x1 - d, y0, x1, y0 + d), 270, 360, fill=color, width=width)
    draw.arc((x0, y1 - d, x0 + d, y1), 90, 180, fill=color, width=width)
    draw.arc((x1 - d, y1 - d, x1, y1), 0, 90, fill=color, width=width)


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

    # Centered primary lockup — icon 1H (28pt), gap 0.42H, wordmark 0.78H.
    mark_side = 28 * scale
    wordmark_font = load_wordmark_font(int(22 * scale))
    wordmark = "Shelf"
    wm_w = draw.textlength(wordmark, font=wordmark_font)
    gap = int(mark_side * 0.42)
    total = mark_side + gap + wm_w
    lx = int((w - total) / 2)
    ly = 26 * scale
    draw_mark(img, lx, ly, mark_side)
    draw = ImageDraw.Draw(img)
    wm_bbox = wordmark_font.getbbox(wordmark)
    wm_y = ly + (mark_side - (wm_bbox[3] - wm_bbox[1])) / 2 - wm_bbox[1]
    draw.text((lx + mark_side + gap, wm_y), wordmark, font=wordmark_font, fill=INK)

    tagline = "You build the tools. Shelf keeps them."
    tag_font = load_font(12 * scale, False)
    tw = draw.textlength(tagline, font=tag_font)
    draw.text(((w - tw) / 2, 66 * scale), tagline, font=tag_font, fill=MUTED)

    # Dashed drop-zones around both icon slots (icons are 110pt; the zone
    # leaves 9pt of air on every side).
    zone = (ICON_SIZE + 18) * scale
    for cx_pt, cy_pt in ICON_CENTERS:
        cx_px, cy_px = cx_pt * scale, cy_pt * scale
        box = (
            int(cx_px - zone / 2),
            int(cy_px - zone / 2),
            int(cx_px + zone / 2),
            int(cy_px + zone / 2),
        )
        dashed_rounded_rect(
            draw, box, radius=int(24 * scale), color=DASH,
            width=max(1, 1 * scale), dash=7 * scale, gap=5 * scale,
        )

    # Arrow between the zones.
    y = 190 * scale
    x0, x1 = 262 * scale, 396 * scale
    lw = max(3 * scale, 3)
    draw.line((x0, y, x1, y), fill=BRAND, width=lw)
    head = 13 * scale
    draw.polygon(
        [(x1 + head, y), (x1 - head // 2, y - head), (x1 - head // 2, y + head)],
        fill=BRAND,
    )

    # Caption + trust line under the icon row (clear of Finder's labels).
    caption = "Drag Shelf to Applications to install"
    font = load_font(15 * scale, True)
    tw = draw.textlength(caption, font=font)
    draw.text(((w - tw) / 2, 322 * scale), caption, font=font, fill=INK)

    sub = "No cloud · No account · MIT"
    font_sub = load_font(11 * scale, False)
    tw = draw.textlength(sub, font=font_sub)
    draw.text(((w - tw) / 2, 350 * scale), sub, font=font_sub, fill=SUBTLE)

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
