#!/usr/bin/env python3
"""Swap strip frames 6↔7 so side idle (STRIP_COL_IDLE @ origin 6) is idle art, not walk1."""
from pathlib import Path
from PIL import Image

SKIP = {
    'bumblebee.png',
    'metabee.png',
    'grok.png',
    # Re-converted strips already use reorder [1,0,2,4,3,5,6,7,8]
    'jarvis.png',
    'gemini.png',
    'claude.png',
    'claude_cowork.png',
    'claude_code.png',
}
ROOT = Path(__file__).resolve().parents[1] / 'public/assets/sprites'


def swap_frames_6_7(path: Path) -> None:
    img = Image.open(path).convert('RGBA')
    if img.width != 144 or img.height != 32:
        return
    fw = 16
    f6 = img.crop((6 * fw, 0, 7 * fw, 32))
    f7 = img.crop((7 * fw, 0, 8 * fw, 32))
    img.paste(f7, (6 * fw, 0))
    img.paste(f6, (7 * fw, 0))
    img.save(path)
    print('fixed', path.name)


def main():
    for png in sorted(ROOT.glob('*.png')):
        if png.name in SKIP:
            continue
        swap_frames_6_7(png)


if __name__ == '__main__':
    main()
