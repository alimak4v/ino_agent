#!/usr/bin/env python3
"""Build a transparent app icon from assets/logo.png."""

from __future__ import annotations

import os

from PySide6.QtGui import QImage


def make_transparent_icon(src: str, dst: str, threshold: int = 248) -> None:
    image = QImage(src)
    if image.isNull():
        raise SystemExit(f"Could not read icon source: {src}")

    image = image.convertToFormat(QImage.Format.Format_ARGB32)
    for y in range(image.height()):
        for x in range(image.width()):
            color = image.pixelColor(x, y)
            if color.red() >= threshold and color.green() >= threshold and color.blue() >= threshold:
                color.setAlpha(0)
                image.setPixelColor(x, y, color)

    if not image.save(dst):
        raise SystemExit(f"Could not write icon: {dst}")


def main() -> None:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(base_dir, "assets", "logo.png")
    dst = os.path.join(base_dir, "assets", "icon.png")
    if not os.path.exists(src):
        raise SystemExit(f"Missing {src}")
    make_transparent_icon(src, dst)
    print(f"Wrote {dst}")


if __name__ == "__main__":
    main()
