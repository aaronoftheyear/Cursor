#!/usr/bin/env python3
"""
Reorder frames in a 144x32 sprite strip.

Original order: 1,2,3,4,5,6,7,8,9
New order:      2,1,3,5,4,6,8,7,9

Swaps: 1↔2, 4↔5, 7↔8 (1-based, each frame 16x32)
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Error: PIL not installed. Run: pip install Pillow")
    sys.exit(1)


def reorder_strip(input_path: Path, output_path: Path = None) -> None:
    """Reorder frames in a 144x32 strip by swapping pairs."""
    img = Image.open(input_path)
    
    if img.width != 144 or img.height != 32:
        print(f"Skipping {input_path.name}: not 144x32 (is {img.width}x{img.height})")
        return False
    
    frame_width = 16
    frame_height = 32
    
    # Extract all 9 frames
    frames = []
    for i in range(9):
        x = i * frame_width
        frame = img.crop((x, 0, x + frame_width, frame_height))
        frames.append(frame)
    
    # Aaron frame order 213546879 (1-based) → 0-based [1,0,2,4,3,5,7,6,8]
    new_order = [1, 0, 2, 4, 3, 5, 7, 6, 8]
    
    # Create new image
    new_img = Image.new('RGBA', (144, 32))
    for new_pos, old_pos in enumerate(new_order):
        x = new_pos * frame_width
        new_img.paste(frames[old_pos], (x, 0))
    
    out = output_path or input_path
    new_img.save(out)
    print(f"Reordered: {input_path.name}")
    return True


def main():
    if len(sys.argv) < 2:
        print("Usage: reorder-strip-frames.py <sprite.png> [output.png]")
        print("       reorder-strip-frames.py --all <sprites_dir>")
        sys.exit(1)
    
    if sys.argv[1] == '--all':
        if len(sys.argv) < 3:
            print("Usage: reorder-strip-frames.py --all <sprites_dir>")
            sys.exit(1)
        
        sprites_dir = Path(sys.argv[2])
        # All strips except metabee
        exclude = {'metabee.png'}
        count = 0
        for png in sprites_dir.glob('*.png'):
            if png.name in exclude:
                continue
            if reorder_strip(png):
                count += 1
        print(f"Reordered {count} sprites")
    else:
        input_path = Path(sys.argv[1])
        output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
        reorder_strip(input_path, output_path)


if __name__ == '__main__':
    main()
