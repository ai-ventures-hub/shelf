#!/usr/bin/env python3
"""Generate Shelf Dock/app icon and macOS menu-bar Template images.

Brand Standard v1.0: the mark is the ink bracket glyph on the 145° indigo
gradient tile (22% corner radius). The app icon draws that tile on the
macOS Big Sur icon grid (824pt artwork centered on a 1024pt canvas) — no
glow in any icon export. Tray templates are the bare glyph in black for
macOS Template tinting.

Requires Pillow. Outputs are committed so CI never needs this script.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "build"

MARK_GRAD_A = (154, 175, 255)  # #9aafff
MARK_GRAD_B = (82, 111, 221)  # #526fdd
MARK_INK = (8, 16, 33)  # #081021

# Official glyph — favicon geometry in a 0..100 tile space.
# M20 18h60v18H40v14H20V18z / M20 82h60V50H58v14H20V82z
GLYPH_POLYGONS = (
    ((20, 18), (80, 18), (80, 36), (40, 36), (40, 50), (20, 50)),
    ((20, 82), (80, 82), (80, 50), (58, 50), (58, 64), (20, 64)),
)


def render_mark_tile(side: int, oversample: int = 4) -> Image.Image:
    """The sealed mark: gradient tile, 22% radius, ink glyph. RGBA."""
    s_px = side * oversample
    tile = Image.new("RGB", (s_px, s_px))
    px = tile.load()
    # Linear gradient along the 145° axis ≈ favicon's (10,10)→(90,90) run.
    for j in range(s_px):
        for i in range(s_px):
            k = min(1.0, max(0.0, (i + j) / (2 * s_px * 0.8) - 0.125))
            px[i, j] = tuple(
                int(a + (b - a) * k) for a, b in zip(MARK_GRAD_A, MARK_GRAD_B)
            )
    draw = ImageDraw.Draw(tile)
    unit = s_px / 100.0
    for poly in GLYPH_POLYGONS:
        draw.polygon([(x * unit, y * unit) for x, y in poly], fill=MARK_INK)

    mask = Image.new("L", (s_px, s_px), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, s_px - 1, s_px - 1), radius=int(s_px * 0.22), fill=255
    )
    out = Image.new("RGBA", (s_px, s_px), (0, 0, 0, 0))
    out.paste(tile, (0, 0), mask)
    return out.resize((side, side), Image.LANCZOS)


def write_app_icon(path: Path, size: int = 1024) -> None:
    """Official mark on the macOS icon grid: artwork is 824/1024 centered."""
    art_side = round(size * 824 / 1024)
    inset = (size - art_side) // 2
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(render_mark_tile(art_side), (inset, inset))
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path)
    print(f"Wrote {path}")


def write_tray_glyph(path: Path, size: int, fill: tuple[int, int, int, int]) -> None:
    """Glyph-on-transparent tray asset. Black = macOS Template tinting;
    brand-colored (non-template) = the active state when tools are running."""
    oversample = 8
    s_px = size * oversample
    img = Image.new("RGBA", (s_px, s_px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Slightly reduced inset so the glyph holds weight at menu-bar sizes.
    unit = s_px / 100.0

    def stretch(v: float) -> float:
        # Map the glyph's 18..82 content box out to 10..90.
        return (v - 18) * (80 / 64) + 10

    for poly in GLYPH_POLYGONS:
        draw.polygon(
            [(stretch(x) * unit, stretch(y) * unit) for x, y in poly],
            fill=fill,
        )
    img = img.resize((size, size), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print(f"Wrote {path}")


def write_tray_template(path: Path, size: int) -> None:
    write_tray_glyph(path, size, (0, 0, 0, 255))


# Menu-bar active tint — brand indigo (--brand, dark theme).
TRAY_ACTIVE = (120, 149, 255, 255)  # #7895ff


if __name__ == "__main__":
    write_app_icon(ROOT / "icon.png")
    # Template suffix + @2x lets Electron/macOS pick the crisp asset.
    write_tray_template(ROOT / "TrayIconTemplate.png", 22)
    write_tray_template(ROOT / "TrayIconTemplate@2x.png", 44)
    # Non-template brand-colored variant: shown while any tool is running.
    write_tray_glyph(ROOT / "TrayIconActive.png", 22, TRAY_ACTIVE)
    write_tray_glyph(ROOT / "TrayIconActive@2x.png", 44, TRAY_ACTIVE)
