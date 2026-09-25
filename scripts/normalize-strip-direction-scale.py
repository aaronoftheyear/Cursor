#!/usr/bin/env python3
"""
Normalize 144x32 avatar strips so every frame uses the same character height.

The converter bottom-aligns each frame's bbox independently, so side-facing
cells often end up taller than down/up. The renderer draws the full 16x32 cell
at a fixed displayScale for every direction (left uses the same dest rect as
down; right mirrors that rect). Taller opaque pixels in the side column therefore
made every avatar look larger when facing/walking left — not a separate flip
scale in the renderer.

This script scales each frame's content uniformly to the sheet's max content
height, feet still on the bottom row of the 16x32 cell.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

FRAME_W = 16
FRAME_H = 32
FRAME_COUNT = 9


def frame_content(frame_img: Image.Image) -> Image.Image | None:
    bbox = frame_img.getbbox()
    if not bbox:
        return None
    return frame_img.crop(bbox)


def compose_frame(content: Image.Image, norm_height: int) -> Image.Image:
    out = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    if content.height <= 0 or content.width <= 0:
        return out
    scale = norm_height / content.height
    new_w = max(1, round(content.width * scale))
    new_h = norm_height
    resized = content.resize((new_w, new_h), Image.Resampling.NEAREST)
    paste_x = (FRAME_W - new_w) // 2
    paste_y = FRAME_H - new_h
    paste_x = max(0, min(paste_x, FRAME_W - new_w))
    paste_y = max(0, min(paste_y, FRAME_H - new_h))
    out.paste(resized, (paste_x, paste_y))
    return out


def normalize_strip(img: Image.Image) -> tuple[Image.Image, int]:
    if img.width != 144 or img.height != 32:
        raise ValueError(f"Expected 144x32 strip, got {img.width}x{img.height}")

    contents: list[Image.Image | None] = []
    heights: list[int] = []
    for i in range(FRAME_COUNT):
        x0 = i * FRAME_W
        frame = img.crop((x0, 0, x0 + FRAME_W, FRAME_H))
        content = frame_content(frame)
        contents.append(content)
        if content is not None:
            heights.append(content.height)

    if not heights:
        return img.copy(), 0

    norm_height = max(heights)
    out = Image.new("RGBA", (144, 32), (0, 0, 0, 0))
    for i, content in enumerate(contents):
        frame = compose_frame(content, norm_height) if content is not None else Image.new(
            "RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0)
        )
        out.paste(frame, (i * FRAME_W, 0))
    return out, norm_height


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize direction frame heights in 144x32 strips")
    parser.add_argument("paths", nargs="+", help="PNG strip files or directories")
    parser.add_argument("--dry-run", action="store_true", help="Print stats only")
    args = parser.parse_args()

    files: list[Path] = []
    for p in args.paths:
        path = Path(p)
        if path.is_dir():
            files.extend(sorted(path.glob("*.png")))
        else:
            files.append(path)

    for path in files:
        try:
            img = Image.open(path).convert("RGBA")
            if img.width != 144 or img.height != 32:
                continue
            normalized, norm_h = normalize_strip(img)
            print(f"{path.name}: norm_height={norm_h}")
            if not args.dry_run:
                normalized.save(path)
        except Exception as e:
            print(f"Skip {path}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
