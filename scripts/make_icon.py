#!/usr/bin/env python3
"""Generate polished transparent app icons for treeAI."""

from __future__ import annotations

import struct
import subprocess
import zlib
import shutil
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icon.png"
if not SRC.exists():
    SRC = ROOT / "assets" / "logo.png"
if not SRC.exists() and (ROOT / "assets" / "new_logo.png").exists():
    SRC = ROOT / "assets" / "new_logo.png"

ASSET_ICON = ROOT / "assets" / "icon.png"
ASSET_ICNS = ROOT / "assets" / "app.icns"
OUT_ICON = ROOT / "src-tauri" / "icons" / "icon.png"
ICONS_DIR = ROOT / "src-tauri" / "icons"
CANVAS_SIZE = 1024
ICON_SCALE = 2


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


def sample_corners(pixels: list[list[tuple[int, int, int, int]]]) -> tuple[float, float, float, float]:
    h = len(pixels)
    w = len(pixels[0])
    pts = [pixels[0][0], pixels[0][w - 1], pixels[h - 1][0], pixels[h - 1][w - 1]]
    return (
        sum(p[0] for p in pts) / 4,
        sum(p[1] for p in pts) / 4,
        sum(p[2] for p in pts) / 4,
        sum(p[3] for p in pts) / 4,
    )


def write_png(path: Path, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    height = len(pixels)
    width = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend((r, g, b, a))
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def mix(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def blend_pixel(
    dst: tuple[int, int, int, int],
    src: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    sr, sg, sb, sa = src
    if sa <= 0:
        return dst
    if sa >= 255:
        return src
    dr, dg, db, da = dst
    src_a = sa / 255
    dst_a = da / 255
    out_a = src_a + dst_a * (1 - src_a)
    if out_a <= 0:
        return (0, 0, 0, 0)
    out_r = (sr * src_a + dr * dst_a * (1 - src_a)) / out_a
    out_g = (sg * src_a + dg * dst_a * (1 - src_a)) / out_a
    out_b = (sb * src_a + db * dst_a * (1 - src_a)) / out_a
    return (round(out_r), round(out_g), round(out_b), round(out_a * 255))


def rounded_rect_contains(px: float, py: float, x: float, y: float, w: float, h: float, r: float) -> bool:
    if px < x or py < y or px >= x + w or py >= y + h:
        return False
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r


def fill_rounded_rect_gradient(
    rows: list[list[tuple[int, int, int, int]]],
    x: int,
    y: int,
    w: int,
    h: int,
    r: int,
    top: tuple[int, int, int, int],
    bottom: tuple[int, int, int, int],
) -> None:
    height = len(rows)
    width = len(rows[0])
    for py in range(max(0, y), min(height, y + h)):
        t = (py - y) / max(1, h - 1)
        color = (
            mix(top[0], bottom[0], t),
            mix(top[1], bottom[1], t),
            mix(top[2], bottom[2], t),
            mix(top[3], bottom[3], t),
        )
        row = rows[py]
        for px in range(max(0, x), min(width, x + w)):
            if rounded_rect_contains(px + 0.5, py + 0.5, x, y, w, h, r):
                row[px] = blend_pixel(row[px], color)


def fill_circle(
    rows: list[list[tuple[int, int, int, int]]],
    cx: int,
    cy: int,
    radius: int,
    color: tuple[int, int, int, int],
) -> None:
    height = len(rows)
    width = len(rows[0])
    r2 = radius * radius
    for py in range(max(0, cy - radius), min(height, cy + radius + 1)):
        dy = py + 0.5 - cy
        row = rows[py]
        for px in range(max(0, cx - radius), min(width, cx + radius + 1)):
            dx = px + 0.5 - cx
            if dx * dx + dy * dy <= r2:
                row[px] = blend_pixel(row[px], color)


def fill_capsule(
    rows: list[list[tuple[int, int, int, int]]],
    x: int,
    y: int,
    w: int,
    h: int,
    color: tuple[int, int, int, int],
) -> None:
    radius = min(w, h) // 2
    fill_rounded_rect_gradient(rows, x, y, w, h, radius, color, color)


def draw_line(
    rows: list[list[tuple[int, int, int, int]]],
    ax: int,
    ay: int,
    bx: int,
    by: int,
    width: int,
    color: tuple[int, int, int, int],
) -> None:
    height = len(rows)
    canvas_width = len(rows[0])
    radius = width / 2
    pad = int(radius) + 2
    min_x = max(0, min(ax, bx) - pad)
    max_x = min(canvas_width - 1, max(ax, bx) + pad)
    min_y = max(0, min(ay, by) - pad)
    max_y = min(height - 1, max(ay, by) + pad)
    vx = bx - ax
    vy = by - ay
    length2 = vx * vx + vy * vy
    for py in range(min_y, max_y + 1):
        row = rows[py]
        for px in range(min_x, max_x + 1):
            if length2 == 0:
                nearest_x, nearest_y = ax, ay
            else:
                t = ((px + 0.5 - ax) * vx + (py + 0.5 - ay) * vy) / length2
                t = max(0.0, min(1.0, t))
                nearest_x = ax + t * vx
                nearest_y = ay + t * vy
            dx = px + 0.5 - nearest_x
            dy = py + 0.5 - nearest_y
            if dx * dx + dy * dy <= radius * radius:
                row[px] = blend_pixel(row[px], color)


def box_downsample(
    src: list[list[tuple[int, int, int, int]]],
    factor: int,
) -> list[list[tuple[int, int, int, int]]]:
    out_size = len(src) // factor
    out: list[list[tuple[int, int, int, int]]] = []
    area = factor * factor
    for y in range(out_size):
        row: list[tuple[int, int, int, int]] = []
        for x in range(out_size):
            total = [0, 0, 0, 0]
            for yy in range(factor):
                for xx in range(factor):
                    pixel = src[y * factor + yy][x * factor + xx]
                    for i in range(4):
                        total[i] += pixel[i]
            row.append(tuple(round(value / area) for value in total))  # type: ignore[arg-type]
        out.append(row)
    return out


def generate_icon_rows(size: int = CANVAS_SIZE, scale: int = ICON_SCALE) -> list[list[tuple[int, int, int, int]]]:
    s = size * scale
    rows = [[(0, 0, 0, 0) for _ in range(s)] for _ in range(s)]

    def c(value: int) -> int:
        return value * scale

    # Soft material shadow, intentionally much crisper than the previous Dock icon.
    fill_rounded_rect_gradient(
        rows,
        c(100),
        c(116),
        c(824),
        c(820),
        c(206),
        (20, 37, 52, 34),
        (20, 37, 52, 10),
    )
    fill_rounded_rect_gradient(
        rows,
        c(84),
        c(72),
        c(856),
        c(856),
        c(216),
        (248, 253, 250, 255),
        (216, 238, 255, 255),
    )
    fill_rounded_rect_gradient(
        rows,
        c(116),
        c(104),
        c(792),
        c(792),
        c(188),
        (255, 255, 255, 76),
        (255, 255, 255, 12),
    )
    fill_rounded_rect_gradient(
        rows,
        c(84),
        c(72),
        c(856),
        c(856),
        c(216),
        (255, 255, 255, 42),
        (71, 130, 177, 38),
    )

    ink = (18, 43, 56, 255)
    ink_soft = (18, 43, 56, 58)
    teal = (38, 200, 178, 255)
    blue = (78, 137, 255, 255)
    pale = (236, 255, 250, 255)

    # Shadow under the mark.
    for ax, ay, bx, by in [
        (360, 380, 255, 548),
        (360, 380, 505, 548),
        (255, 548, 190, 704),
        (255, 548, 430, 720),
        (505, 548, 620, 720),
    ]:
        draw_line(rows, c(ax + 8), c(ay + 10), c(bx + 8), c(by + 10), c(54), ink_soft)
    fill_capsule(rows, c(716), c(425), c(80), c(276), (18, 43, 56, 42))
    fill_circle(rows, c(756), c(343), c(48), (18, 43, 56, 38))

    # Tree / A monogram.
    for ax, ay, bx, by in [
        (360, 380, 255, 548),
        (360, 380, 505, 548),
        (255, 548, 190, 704),
        (255, 548, 430, 720),
        (505, 548, 620, 720),
    ]:
        draw_line(rows, c(ax), c(ay), c(bx), c(by), c(52), ink)

    for cx, cy, radius, color in [
        (360, 380, 62, blue),
        (255, 548, 52, teal),
        (505, 548, 52, teal),
        (190, 704, 43, pale),
        (430, 720, 43, pale),
        (620, 720, 43, pale),
    ]:
        fill_circle(rows, c(cx), c(cy), c(radius), (18, 43, 56, 255))
        fill_circle(rows, c(cx), c(cy), c(radius - 12), color)

    # Bold AI "i" companion.
    fill_capsule(rows, c(718), c(424), c(76), c(276), ink)
    fill_circle(rows, c(756), c(342), c(46), ink)
    fill_circle(rows, c(756), c(342), c(26), teal)

    return box_downsample(rows, scale)


def make_transparent(path: Path) -> None:
    width, height, color_type, raw = read_png(path)
    rows = decode_rows(width, height, color_type, raw)
    avg = sample_corners(rows)
    light_bg = sum(avg[:3]) / 3 >= 128

    def is_background(pixel: tuple[int, int, int, int]) -> bool:
        r, g, b, a = pixel
        if a == 0:
            return True
        brightness = (r + g + b) / 3
        neutral = max(r, g, b) - min(r, g, b) <= 42
        if light_bg:
            return neutral and brightness >= 150
        return brightness <= 30

    queue: deque[tuple[int, int]] = deque()
    seen = [[False] * width for _ in range(height)]
    for x in range(width):
        for y in (0, height - 1):
            if is_background(rows[y][x]):
                seen[y][x] = True
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if not seen[y][x] and is_background(rows[y][x]):
                seen[y][x] = True
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        r, g, b, _ = rows[y][x]
        rows[y][x] = (r, g, b, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height and not seen[ny][nx]:
                if is_background(rows[ny][nx]):
                    seen[ny][nx] = True
                    queue.append((nx, ny))
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


def trim_transparent_padding(
    src: list[list[tuple[int, int, int, int]]],
    alpha_threshold: int = 8,
) -> list[list[tuple[int, int, int, int]]]:
    height = len(src)
    width = len(src[0])
    min_x, min_y = width, height
    max_x = max_y = -1
    for y, row in enumerate(src):
        for x, (_, _, _, a) in enumerate(row):
            if a > alpha_threshold:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    if max_x < min_x or max_y < min_y:
        return src

    crop_width = max_x - min_x + 1
    crop_height = max_y - min_y + 1
    side = max(crop_width, crop_height)
    pad_x = (side - crop_width) // 2
    pad_y = (side - crop_height) // 2
    transparent = (0, 0, 0, 0)
    square = [[transparent for _ in range(side)] for _ in range(side)]
    for y in range(crop_height):
        for x in range(crop_width):
            square[y + pad_y][x + pad_x] = src[min_y + y][min_x + x]
    return square


def center_on_transparent_canvas(
    src: list[list[tuple[int, int, int, int]]],
    canvas_size: int,
) -> list[list[tuple[int, int, int, int]]]:
    height = len(src)
    width = len(src[0])
    transparent = (0, 0, 0, 0)
    out = [[transparent for _ in range(canvas_size)] for _ in range(canvas_size)]
    offset_x = (canvas_size - width) // 2
    offset_y = (canvas_size - height) // 2
    for y, row in enumerate(src):
        for x, pixel in enumerate(row):
            out[y + offset_y][x + offset_x] = pixel
    return out


def resize_png(
    source: Path,
    destination: Path,
    size: int,
    rows: list[list[tuple[int, int, int, int]]],
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if shutil.which("sips"):
        subprocess.run(
            ["sips", "-z", str(size), str(size), str(source), "--out", str(destination)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    write_png(destination, resize_nearest(rows, size))


def remove_extra_tauri_icons() -> None:
    paths = [
        ICONS_DIR / "64x64.png",
        ICONS_DIR / "StoreLogo.png",
        ICONS_DIR / "icon.ico",
        ICONS_DIR / "android",
        ICONS_DIR / "ios",
    ]
    paths.extend(sorted(ICONS_DIR.glob("Square*.png")))
    for path in paths:
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    rows = generate_icon_rows()
    write_png(ASSET_ICON, rows)
    write_png(OUT_ICON, rows)
    if shutil.which("npx"):
        subprocess.run(["npx", "tauri", "icon", str(ASSET_ICON)], check=True)
        remove_extra_tauri_icons()
        write_png(OUT_ICON, rows)
        if (ICONS_DIR / "icon.icns").exists():
            shutil.copy2(ICONS_DIR / "icon.icns", ASSET_ICNS)
    else:
        for size, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png")]:
            resize_png(ASSET_ICON, ICONS_DIR / name, size, rows)
    print(f"Wrote icons to {ICONS_DIR} and {ASSET_ICON}")


if __name__ == "__main__":
    main()
