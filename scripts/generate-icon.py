#!/usr/bin/env python3
"""Generate Shelf Dock/app icon and macOS menu-bar Template images."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# Match the Dock mark: solid periwinkle field, near-black geometric S.
BG = (176, 171, 232)  # #b0abe8
FG = (10, 10, 15)


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def in_rounded_square(nx: float, ny: float, radius: float = 0.22) -> bool:
    """Unit-square rounded rect mask (icon squircle approximation)."""
    x = abs(nx - 0.5) * 2
    y = abs(ny - 0.5) * 2
    # Inside core square
    if x <= 1 - radius and y <= 1 - radius:
        return True
    if x > 1 - radius and y > 1 - radius:
        cx = x - (1 - radius)
        cy = y - (1 - radius)
        return cx * cx + cy * cy <= radius * radius
    return x <= 1 and y <= 1


def in_s_mark(nx: float, ny: float) -> bool:
    """
    Two offset L-blocks forming an S, with a clear center gap.
    Coordinates in 0..1 within the icon.
    """
    # Content inset so the mark floats inside the squircle
    left, right = 0.28, 0.72
    top, bottom = 0.24, 0.76
    mid_gap_top, mid_gap_bot = 0.46, 0.54
    thick = 0.12
    stem = 0.16

    # Top ⌐ block
    in_top_bar = left <= nx <= right and top <= ny <= top + thick
    in_top_stem = left <= nx <= left + stem and top <= ny <= mid_gap_top
    # Bottom L block
    in_bot_bar = left <= nx <= right and bottom - thick <= ny <= bottom
    in_bot_stem = right - stem <= nx <= right and mid_gap_bot <= ny <= bottom

    return in_top_bar or in_top_stem or in_bot_bar or in_bot_stem


def write_png_rgba(path: Path, size: int, pixel_at) -> None:
    """Write an 8-bit RGBA PNG using pixel_at(nx, ny) -> (r,g,b,a)."""
    rows: list[bytes] = []
    for y in range(size):
        row = bytearray()
        row.append(0)
        ny = (y + 0.5) / size
        for x in range(size):
            nx = (x + 0.5) / size
            row.extend(pixel_at(nx, ny))
        rows.append(bytes(row))

    raw = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    print(f"Wrote {path} ({len(png)} bytes)")


def write_app_icon(path: Path, size: int = 1024) -> None:
    def pixel(nx: float, ny: float) -> tuple[int, int, int, int]:
        if not in_rounded_square(nx, ny):
            return (0, 0, 0, 0)
        if in_s_mark(nx, ny):
            return (*FG, 255)
        return (*BG, 255)

    write_png_rgba(path, size, pixel)


def write_tray_template(path: Path, size: int) -> None:
    """
    Black-on-transparent S for macOS Template images.
    Colorful Dock icons become muddy when force-templated at 18px.
    """

    def pixel(nx: float, ny: float) -> tuple[int, int, int, int]:
        # Slightly thicker strokes at menu-bar sizes so the mark stays legible.
        if in_s_mark_tray(nx, ny):
            return (0, 0, 0, 255)
        return (0, 0, 0, 0)

    write_png_rgba(path, size, pixel)


def in_s_mark_tray(nx: float, ny: float) -> bool:
    """S mark tuned for ~16–44px menu bar (thicker stems, less inset)."""
    left, right = 0.22, 0.78
    top, bottom = 0.18, 0.82
    mid_gap_top, mid_gap_bot = 0.45, 0.55
    thick = 0.16
    stem = 0.22

    in_top_bar = left <= nx <= right and top <= ny <= top + thick
    in_top_stem = left <= nx <= left + stem and top <= ny <= mid_gap_top
    in_bot_bar = left <= nx <= right and bottom - thick <= ny <= bottom
    in_bot_stem = right - stem <= nx <= right and mid_gap_bot <= ny <= bottom

    return in_top_bar or in_top_stem or in_bot_bar or in_bot_stem


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1] / "build"
    write_app_icon(root / "icon.png")
    # Template suffix + @2x lets Electron/macOS pick the crisp asset.
    write_tray_template(root / "TrayIconTemplate.png", 22)
    write_tray_template(root / "TrayIconTemplate@2x.png", 44)
