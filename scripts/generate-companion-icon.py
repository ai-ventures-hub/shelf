"""
Home Screen icon for the Companion web app: the Shelf mark on the brand
gradient, filling the whole square (iOS applies its own corner mask; a
transparent-cornered icon would show black corners). 180x180, the size
Safari asks for as apple-touch-icon.

Run: python3 scripts/generate-companion-icon.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 180
OUT = Path(__file__).resolve().parent.parent / "build" / "companion-touch-icon.png"
START = (0x9A, 0xAF, 0xFF)  # #9aafff
END = (0x52, 0x6F, 0xDD)    # #526fdd
INK = (0x08, 0x10, 0x21)    # #081021


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def main() -> None:
    scale = 4
    px = SIZE * scale
    img = Image.new("RGB", (px, px))
    pixels = img.load()
    # 145° gradient like the brand tile: top-left light, bottom-right deep.
    for y in range(px):
        for x in range(px):
            t = (x + y) / (2 * (px - 1))
            pixels[x, y] = lerp(START, END, t)
    draw = ImageDraw.Draw(img)
    # ShelfMark path on a 100-unit box: M20 18h60v18H40v14H20V18z M20 82h60V50H58v14H20V82z
    unit = px / 100
    top = [(20, 18), (80, 18), (80, 36), (40, 36), (40, 50), (20, 50)]
    bottom = [(20, 82), (80, 82), (80, 50), (58, 50), (58, 64), (20, 64)]
    for poly in (top, bottom):
        draw.polygon([(x * unit, y * unit) for x, y in poly], fill=INK)
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
