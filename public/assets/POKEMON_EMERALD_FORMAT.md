# Pokemon Emerald Asset Format

Reference from: https://github.com/pret/pokeemerald

## Character Sprites (Overworld)

**Format:** Horizontal strip, 4-bit indexed PNG (16 colors)

**Standard NPC size:** `144 x 32` pixels
- 9 frames of `16 x 32` each
- Frame layout: `[D1][D2][D3][U1][U2][U3][L1][L2][L3]`
- Right-facing = Left-facing flipped horizontally

```
┌────┬────┬────┬────┬────┬────┬────┬────┬────┐
│ D1 │ D2 │ D3 │ U1 │ U2 │ U3 │ L1 │ L2 │ L3 │
└────┴────┴────┴────┴────┴────┴────┴────┴────┘
  ↓    ↓    ↓    ↑    ↑    ↑    ←    ←    ←
 16px each, 32px tall
```

**Walking animation:** Frame 1 → Frame 2 → Frame 1 → Frame 3 (4-beat cycle using 3 frames)

## Your Agents - What to Create

| Agent | Filename | Size |
|-------|----------|------|
| J.A.R.V.I.S. | `jarvis.png` | 144 x 32 |
| F.R.I.D.A.Y. | `friday.png` | 144 x 32 |
| Bumblebee | `bumblebee.png` | 144 x 32 |
| Cursor | `cursor.png` | 144 x 32 |
| Claude | `claude.png` | 144 x 32 |
| Claude Code | `claude_code.png` | 144 x 32 |
| Claude Cowork | `claude_cowork.png` | 144 x 32 |
| Grok | `grok.png` | 144 x 32 |
| Gemini | `gemini.png` | 144 x 32 |
| Apple Intelligence | `apple.png` | 144 x 32 |

## Tilesets

**Format:** `128 x 256` pixels, 4-bit indexed PNG

**Tile size:** 8x8 pixels (GBA standard), arranged in 16x32 grid

**Building/Indoor tileset includes:**
- Floor patterns
- Walls
- Furniture (desks, chairs, computers)
- Decorations

See `reference_building_tileset.png` for the actual Pokemon Emerald indoor tileset.

## Color Palette

Pokemon Emerald uses **16 colors per palette** (4-bit).

**Typical NPC palette:**
- Color 0: Transparent (magenta #FF00FF in source)
- Colors 1-3: Skin tones
- Colors 4-7: Main clothing
- Colors 8-11: Secondary clothing/hair
- Colors 12-15: Accents/shadows

## Reference Files Included

I've copied these from pokeemerald for reference:

- `reference_npc_sprite.png` - Boy NPC (144x32, 9 frames)
- `reference_building_tileset.png` - Indoor building tiles (128x256)

## Tools

- **Aseprite** - Create/edit sprites with indexed color mode
- **GIMP** - Free alternative, supports indexed PNG
- **Tiled** - Map editor (optional, for designing room layouts)

## Quick Start

1. Open `reference_npc_sprite.png` in Aseprite
2. Study the frame layout and palette
3. Create new 144x32 canvas with indexed 16-color palette
4. Draw your agent in all 9 frames
5. Export as indexed PNG
6. Drop in `/public/assets/sprites/` folder
