#!/usr/bin/env python3
"""Generate the DMG installer background for ino-agent.

Design asset generator: renders a soft violet->indigo gradient, an arrow
pointing from the app icon toward the Applications shortcut, and a short install
instruction at the top. The output is committed to the repo
(src-tauri/dmg/background.png) and consumed directly by Tauri during the macOS
build, so CI does not need to run this script.

Run it only when the DMG design changes:

    pip install pillow   # dev-only dependency
    python3 scripts/make_dmg_background.py

Sizes match bundle.macOS.dmg in tauri.conf.json (windowSize 660x400 and the
icon positions).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "dmg" / "background.png"

# Logical DMG window content size (must match bundle.macOS.dmg.windowSize).
W, H = 660, 400
# Supersampling: render at 2x, then downscale for anti-aliased arrow and text.
SCALE = 2

# Gradient endpoints (top-left -> bottom-right).
C0 = (238, 236, 255)  # light violet
C1 = (197, 206, 252)  # soft indigo

# Arrow (indigo-500), horizontal, pointing right. Aligned with the icon row.
ARROW = (99, 102, 241)
ARROW_CY = 210
SHAFT_X0, HEAD_X0, TIP_X = 255, 360, 405
SHAFT_HALF, HEAD_HALF = 11, 34

# Install instruction shown above the icons.
HEADLINE = "Установка ino-agent"
SUBLINE = "Перетащите приложение в папку Applications"
TEXT_DARK = (58, 61, 107)
TEXT_MUTED = (96, 102, 150)
HEADLINE_CY = 46
SUBLINE_CY = 72

FONT_BOLD = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
FONT_REG = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def load_font(paths: list[str], size: int) -> ImageFont.ImageFont:
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    raise SystemExit(
        "No usable TrueType font found (need DejaVu or Liberation with Cyrillic)."
    )


def render() -> Image.Image:
    w, h = W * SCALE, H * SCALE
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        ty = y / (h - 1)
        for x in range(w):
            t = (x / (w - 1) + ty) / 2.0
            px[x, y] = (
                round(C0[0] + (C1[0] - C0[0]) * t),
                round(C0[1] + (C1[1] - C0[1]) * t),
                round(C0[2] + (C1[2] - C0[2]) * t),
            )

    draw = ImageDraw.Draw(img)

    def s(v: float) -> float:
        return v * SCALE

    cy = s(ARROW_CY)
    draw.polygon(
        [
            (s(SHAFT_X0), cy - s(SHAFT_HALF)),
            (s(HEAD_X0), cy - s(SHAFT_HALF)),
            (s(HEAD_X0), cy - s(HEAD_HALF)),
            (s(TIP_X), cy),
            (s(HEAD_X0), cy + s(HEAD_HALF)),
            (s(HEAD_X0), cy + s(SHAFT_HALF)),
            (s(SHAFT_X0), cy + s(SHAFT_HALF)),
        ],
        fill=ARROW,
    )

    draw.text((w / 2, s(HEADLINE_CY)), HEADLINE,
              font=load_font(FONT_BOLD, int(s(23))), fill=TEXT_DARK, anchor="mm")
    draw.text((w / 2, s(SUBLINE_CY)), SUBLINE,
              font=load_font(FONT_REG, int(s(15))), fill=TEXT_MUTED, anchor="mm")

    return img.resize((W, H), Image.LANCZOS)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    render().save(OUT)
    print(f"Wrote DMG background to {OUT} ({W}x{H})")


if __name__ == "__main__":
    main()
