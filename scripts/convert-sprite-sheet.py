#!/usr/bin/env python3
"""
Convert 93x87 (4-col x 3-row) sprite sheets to 144x32 strip format.
One uniform scale per sheet (widest frame sets scale); feet bottom-aligned.
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
IN_ROWS = 3
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


def extract_frame_content(img: Image.Image, col: int, row: int, cell_w: float, cell_h: float) -> Image.Image | None:
    x = int(col * cell_w)
    y = int(row * cell_h)
    w = int(cell_w)
    h = int(cell_h)
    if col == IN_COLS - 1:
        w = img.width - x
    if row == IN_ROWS - 1:
        h = img.height - y
    bbox = get_bounding_box(img, x, y, w, h)
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
    return min(TARGET_MAX_W / max(widths), TARGET_MAX_H / max(heights))


def compose_output_frame(content: Image.Image, scale: float) -> Image.Image:
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
    available = [c for c in range(4) if c != idle_col]
    return (available[0], available[-1])


def convert_sheet(
    input_path: str,
    output_path: str,
    side_facing: str = 'left',
    idle_col: int = 0,
    metabee_order: bool = False,
) -> None:
    img = Image.open(input_path).convert('RGBA')
    print(f"Input: {input_path} ({img.width}x{img.height})")
    print(f"Idle column: {idle_col}")

    cell_w = img.width / IN_COLS
    cell_h = img.height / IN_ROWS
    walk1_col, walk2_col = get_walk_cols(idle_col)
    print(f"Frame mapping: idle={idle_col}, walk1={walk1_col}, walk2={walk2_col}")

    specs = [
        (idle_col, 0),
        (walk1_col, 0),
        (walk2_col, 0),
        (idle_col, 2),
        (walk1_col, 2),
        (walk2_col, 2),
        (idle_col, 1),
        (walk1_col, 1),
        (walk2_col, 1),
    ]
    contents = [extract_frame_content(img, col, row, cell_w, cell_h) for col, row in specs]
    scale = uniform_sheet_scale(contents)
    print(f"Uniform sheet scale: {scale:.4f}")

    frame_d_idle, frame_d_walk1, frame_d_walk2 = [
        compose_output_frame(c, scale) if c else Image.new('RGBA', (OUT_FRAME_W, OUT_FRAME_H), (0, 0, 0, 0))
        for c in contents[0:3]
    ]
    frame_u_idle, frame_u_walk1, frame_u_walk2 = [
        compose_output_frame(c, scale) if c else Image.new('RGBA', (OUT_FRAME_W, OUT_FRAME_H), (0, 0, 0, 0))
        for c in contents[3:6]
    ]
    frame_s_idle, frame_s_walk1, frame_s_walk2 = [
        compose_output_frame(c, scale) if c else Image.new('RGBA', (OUT_FRAME_W, OUT_FRAME_H), (0, 0, 0, 0))
        for c in contents[6:9]
    ]

    if side_facing == 'right':
        frame_s_idle = frame_s_idle.transpose(Image.FLIP_LEFT_RIGHT)
        frame_s_walk1 = frame_s_walk1.transpose(Image.FLIP_LEFT_RIGHT)
        frame_s_walk2 = frame_s_walk2.transpose(Image.FLIP_LEFT_RIGHT)

    out = Image.new('RGBA', (OUT_STRIP_W, OUT_STRIP_H), (0, 0, 0, 0))
    if metabee_order:
        out.paste(frame_d_idle, (0 * OUT_FRAME_W, 0))
        out.paste(frame_d_walk1, (1 * OUT_FRAME_W, 0))
        out.paste(frame_d_walk2, (2 * OUT_FRAME_W, 0))
        out.paste(frame_u_idle, (3 * OUT_FRAME_W, 0))
        out.paste(frame_u_walk1, (4 * OUT_FRAME_W, 0))
        out.paste(frame_u_walk2, (5 * OUT_FRAME_W, 0))
        out.paste(frame_s_idle, (6 * OUT_FRAME_W, 0))
        out.paste(frame_s_walk1, (7 * OUT_FRAME_W, 0))
        out.paste(frame_s_walk2, (8 * OUT_FRAME_W, 0))
    else:
        out.paste(frame_d_walk1, (0 * OUT_FRAME_W, 0))
        out.paste(frame_d_idle, (1 * OUT_FRAME_W, 0))
        out.paste(frame_d_walk2, (2 * OUT_FRAME_W, 0))
        out.paste(frame_u_walk1, (3 * OUT_FRAME_W, 0))
        out.paste(frame_u_idle, (4 * OUT_FRAME_W, 0))
        out.paste(frame_u_walk2, (5 * OUT_FRAME_W, 0))
        out.paste(frame_s_walk1, (6 * OUT_FRAME_W, 0))
        out.paste(frame_s_idle, (7 * OUT_FRAME_W, 0))
        out.paste(frame_s_walk2, (8 * OUT_FRAME_W, 0))

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    out.save(output_path)
    print(f"Output: {output_path} ({out.width}x{out.height})")


def main():
    parser = argparse.ArgumentParser(description='Convert 93x87 sprite sheets to 144x32 strip format')
    parser.add_argument('input')
    parser.add_argument('output')
    parser.add_argument('--idle-col', type=int, default=0, choices=[0, 1, 2, 3])
    parser.add_argument('--side-facing', choices=['left', 'right'], default='left')
    parser.add_argument('--metabee-order', action='store_true')
    args = parser.parse_args()
    convert_sheet(args.input, args.output, args.side_facing, args.idle_col, args.metabee_order)
    print('Done!')


if __name__ == '__main__':
    main()
