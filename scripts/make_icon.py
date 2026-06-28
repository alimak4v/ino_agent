#!/usr/bin/env python3
"""Generate transparent icon and Tauri icon set from assets/logo.png."""

from __future__ import annotations

import os
import struct
import subprocess
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "logo.png"
if not SRC.exists() and (ROOT / "assets" / "new_logo.png").exists():
    SRC = ROOT / "assets" / "new_logo.png"

OUT_ICON = ROOT / "src-tauri" / "icons" / "icon.png"
ICONS_DIR = ROOT / "src-tauri" / "icons"


def read_png(path: Path) -> tuple[int, int, int, bytes]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"Not a PNG: {path}")
    width = height = None
    color_type = None
    pos = 8
    raw = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        pos += 4
        chunk_type = data[pos : pos + 4]
        pos += 4
        chunk_data = data[pos : pos + length]
        pos += length + 4
        if chunk_type == b"IHDR":
            width, height = struct.unpack(">II", chunk_data[:8])
            color_type = chunk_data[9]
        elif chunk_type == b"IDAT":
            raw += chunk_data
        elif chunk_type == b"IEND":
            break
    if width is None or height is None or color_type is None:
        raise SystemExit("Invalid PNG")
    return width, height, color_type, zlib.decompress(raw)


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def decode_rows(width: int, height: int, color_type: int, raw: bytes) -> list[list[tuple[int, int, int, int]]]:
    bpp = {2: 3, 6: 4}.get(color_type)
    if bpp is None:
        raise SystemExit(f"Unsupported PNG color type: {color_type}")
    stride = width * bpp
    out: list[list[tuple[int, int, int, int]]] = []
    i = 0
    prev = [0] * stride
    for _ in range(height):
        f = raw[i]
        i += 1
        row = list(raw[i : i + stride])
        i += stride
        recon = [0] * stride
        for x in range(stride):
            left = recon[x - bpp] if x >= bpp else 0
            up = prev[x]
            up_left = prev[x - bpp] if x >= bpp else 0
            val = row[x]
            if f == 1:
                val = (val + left) & 0xFF
            elif f == 2:
                val = (val + up) & 0xFF
            elif f == 3:
                val = (val + ((left + up) // 2)) & 0xFF
            elif f == 4:
                val = (val + paeth(left, up, up_left)) & 0xFF
            recon[x] = val
        prev = recon
        pixels: list[tuple[int, int, int, int]] = []
        for px in range(width):
            if bpp == 4:
                r, g, b, a = recon[px * 4 : px * 4 + 4]
            else:
                r, g, b = recon[px * 3 : px * 3 + 3]
                a = 255
            pixels.append((r, g, b, a))
        out.append(pixels)
    return out


def sample_corners(pixels: list[list[tuple[int, int, int, int]]]) -> tuple[float, float, float]:
    h = len(pixels)
    w = len(pixels[0])
    pts = [pixels[0][0], pixels[0][w - 1], pixels[h - 1][0], pixels[h - 1][w - 1]]
    return (
        sum(p[0] for p in pts) / 4,
        sum(p[1] for p in pts) / 4,
        sum(p[2] for p in pts) / 4,
    )


def write_png(path: Path, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    height = len(pixels)
    width = len(pixels[0])
    raw = b""
    for row in pixels:
        raw += b"\x00"
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def make_transparent(path: Path) -> None:
    width, height, color_type, raw = read_png(path)
    rows = decode_rows(width, height, color_type, raw)
    avg = sample_corners(rows)
    dark_bg = sum(avg) / 3 < 128
    threshold = 24
    for y in range(height):
        for x in range(width):
            r, g, b, a = rows[y][x]
            if dark_bg:
                if r <= threshold and g <= threshold and b <= threshold:
                    rows[y][x] = (r, g, b, 0)
            else:
                if r >= 248 and g >= 248 and b >= 248:
                    rows[y][x] = (r, g, b, 0)
    write_png(path, rows)


def resize_nearest(src: list[list[tuple[int, int, int, int]]], size: int) -> list[list[tuple[int, int, int, int]]]:
    h = len(src)
    w = len(src[0])
    out: list[list[tuple[int, int, int, int]]] = []
    for y in range(size):
        row: list[tuple[int, int, int, int]] = []
        sy = int(y * h / size)
        for x in range(size):
            sx = int(x * w / size)
            row.append(src[sy][sx])
        out.append(row)
    return out


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing logo source: {SRC}")
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = ICONS_DIR / "_source.png"
    tmp.write_bytes(SRC.read_bytes())
    make_transparent(tmp)
    width, height, color_type, raw = read_png(tmp)
    rows = decode_rows(width, height, color_type, raw)
    write_png(OUT_ICON, rows)
    for size, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (512, "icon.png")]:
        write_png(ICONS_DIR / name, resize_nearest(rows, size))
    # icns via iconutil if available
    iconset = ICONS_DIR / "app.iconset"
    if iconset.exists():
        import shutil
        shutil.rmtree(iconset)
    iconset.mkdir()
    sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]
    for size, fname in sizes:
        write_png(iconset / fname, resize_nearest(rows, size))
    icns = ICONS_DIR / "icon.icns"
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)], check=False)
    import shutil
    shutil.rmtree(iconset, ignore_errors=True)
    tmp.unlink(missing_ok=True)
    print(f"Wrote icons to {ICONS_DIR}")


if __name__ == "__main__":
    main()
