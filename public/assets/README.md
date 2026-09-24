# Asset Guide - Pokemon GBA Style

Drop your custom assets here to replace the placeholder pixel art.

## Folder Structure

```
assets/
├── sprites/          # Character sprites
│   ├── jarvis/       # J.A.R.V.I.S. sprite sheets
│   ├── friday/       # F.R.I.D.A.Y. sprite sheets
│   ├── bumblebee/    # Bumblebee sprite sheets
│   ├── cursor/       # Cursor sprite sheets
│   ├── claude/       # Claude sprite sheets
│   ├── grok/         # Grok sprite sheets
│   └── ...
├── tiles/            # Map tiles (floor, walls, furniture)
│   ├── floor.png
│   ├── walls.png
│   ├── furniture.png
│   └── decorations.png
├── ui/               # UI elements
│   ├── textbox.png
│   ├── menu.png
│   └── icons.png
└── audio/            # Sound effects & music
    ├── bgm.mp3
    └── sfx/
```

## Sprite Sheet Format (Pokemon GBA Style)

Each character needs a sprite sheet with walking animations:

```
┌────┬────┬────┬────┐
│ D1 │ D2 │ D3 │ D4 │  Row 0: Walking DOWN
├────┼────┼────┼────┤
│ L1 │ L2 │ L3 │ L4 │  Row 1: Walking LEFT
├────┼────┼────┼────┤
│ R1 │ R2 │ R3 │ R4 │  Row 2: Walking RIGHT
├────┼────┼────┼────┤
│ U1 │ U2 │ U3 │ U4 │  Row 3: Walking UP
└────┴────┴────┴────┘

Each frame: 32x32 pixels (or 16x16 for smaller sprites)
Total sheet: 128x128 pixels (for 32x32 frames)
```

## Color Palette (GBA Style)

Pokemon GBA uses limited palettes. Recommended:

- **Background**: #88c070 (grass green) or #f8d878 (indoor floor)
- **Walls**: #705848, #a08070
- **Shadows**: #404040 at 50% opacity
- **Text**: #383838 on #f8f8f8 box

## Recommended Tools

- **Aseprite** - Best for pixel art sprites
- **Tiled** - For creating tile maps
- **GIMP/Photoshop** - General editing

## Naming Convention

```
{agent-id}_{direction}_{frame}.png
```

Or as sprite sheets:
```
{agent-id}_walk.png    # 4x4 sprite sheet
{agent-id}_idle.png    # Single frame or 2-frame idle
```
