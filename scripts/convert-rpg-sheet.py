#!/usr/bin/env python3
"""
Convert 128x192 (4-col x 4-row, 32x48 per frame) RPG-style sprite sheets to 144x32 strip format.

Uses ONE scale per sheet from the widest/tallest source bbox so side-facing frames
are scaled down to match down/up (never upscaling narrow frames to fill cell width).
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

OUT_FRAME_W = 16
OUT_FRAME_H = 32
OUT_STRIP_W = 144
OUT_STRIP_H = 32

IN_COLS = 4
IN_ROWS = 4
IN_FRAME_W = 32
IN_FRAME_H = 48

TARGET_MAX_W = 16
TARGET_MAX_H = OUT_FRAME_H - 2


def get_bounding_box(img: Image.Image, x: int, y: int, w: int, h: int) -> tuple[int, int, int, int]:
    region = img.crop((x, y, x + w, y + h))
    if region.mode != 'RGBA':
        region = region.convert('RGBA')
    pixels = region.load()
    min_x, min_y = w, h
    max_x, max_y = 0, 0
    for py in range(h):
        for px in range(w):
            r, g, b, a = pixels[px, py]
            if a > 0:
                min_x = min(min_x, px)
                min_y = min(min_y, py)
                max_x = max(max_x, px)
                max_y = max(max_y, py)
    if max_x < min_x:
        return (0, 0, w, h)
    return (min_x, min_y, max_x + 1, max_y + 1)


def extract_content(img: Image.Image, col: int, row: int) -> Image.Image | None:
    x = col * IN_FRAME_W
    y = row * IN_FRAME_H
    bbox = get_bounding_box(img, x, y, IN_FRAME_W, IN_FRAME_H)
    bx, by, bx2, by2 = bbox
    cw, ch = bx2 - bx, by2 - by
    if cw <= 0 or ch <= 0:
        return None
    return img.crop((x + bx, y + by, x + bx2, y + by2))


def uniform_sheet_scale(contents: list[Image.Image | None]) -> float:
    widths = [c.width for c in contents if c is not None]
    heights = [c.height for c in contents if c is not None]
    if not widths:
        return 1.0
    max_w = max(widths)
    max_h = max(heights)
    return min(TARGET_MAX_W / max_w, TARGET_MAX_H / max_h)


def compose_frame(content: Image.Image, scale: float) -> Image.Image:
    out_frame = Image.new('RGBA', (OUT_FRAME_W, OUT_FRAME_H), (0, 0, 0, 0))
    new_w = max(1, round(content.width * scale))
    new_h = max(1, round(content.height * scale))
    resized = content.resize((new_w, new_h), Image.Resampling.NEAREST)
    paste_x = (OUT_FRAME_W - new_w) // 2
    paste_y = OUT_FRAME_H - new_h
    paste_x = max(0, min(paste_x, OUT_FRAME_W - new_w))
    paste_y = max(0, min(paste_y, OUT_FRAME_H - new_h))
    out_frame.paste(resized, (paste_x, paste_y))
    return out_frame


def get_walk_cols(idle_col: int) -> tuple[int, int]:
    available = [c for c in range(4) if c != idle_col and c != 3]
    if len(available) < 2:
        available = [c for c in range(4) if c != idle_col]
    return (available[0], available[1] if len(available) > 1 else available[0])


def convert_sheet(input_path: str, output_path: str, idle_col: int = 1) -> None:
    img = Image.open(input_path).convert('RGBA')
    print(f"Input: {input_path} ({img.width}x{img.height})")

    walk1_col, walk2_col = get_walk_cols(idle_col)
    print(f"Frame mapping: idle={idle_col}, walk1={walk1_col}, walk2={walk2_col}")

    specs = [
        (idle_col, 0),
        (walk1_col, 0),
        (walk2_col, 0),
        (idle_col, 3),
        (walk1_col, 3),
        (walk2_col, 3),
        (idle_col, 1),
        (walk1_col, 1),
        (walk2_col, 1),
    ]
    contents = [extract_content(img, col, row) for col, row in specs]
    scale = uniform_sheet_scale(contents)
    print(f"Uniform sheet scale: {scale:.4f} (max content w/h drive fit)")

    frames = [
        compose_frame(c, scale) if c else Image.new('RGBA', (OUT_FRAME_W, OUT_FRAME_H), (0, 0, 0, 0))
        for c in contents
    ]

    out = Image.new('RGBA', (OUT_STRIP_W, OUT_STRIP_H), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        out.paste(frame, (i * OUT_FRAME_W, 0))

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    out.save(output_path)
    print(f"Output: {output_path} ({out.width}x{out.height})")


def main():
    parser = argparse.ArgumentParser(description='Convert 128x192 RPG sprite sheets to 144x32 strip format')
    parser.add_argument('input', help='Input sprite sheet (128x192 PNG)')
    parser.add_argument('output', help='Output strip (144x32 PNG)')
    parser.add_argument('--idle-col', type=int, default=1, choices=[0, 1, 2, 3])
    args = parser.parse_args()
    convert_sheet(args.input, args.output, args.idle_col)
    print('Done!')


if __name__ == '__main__':
    main()
