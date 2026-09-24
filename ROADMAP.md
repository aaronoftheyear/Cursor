# AI Agent Dashboard - Pokemon GBA Style Roadmap

## Current State
- [x] Basic pixel art agents (programmatic)
- [x] Agent walking/idle animations
- [x] Coordinator/subagent hierarchy
- [x] Laya integration for task routing
- [x] Task queue UI

## Phase 1: Visual Overhaul (Pokemon GBA Style)

### Assets Needed
- [ ] Agent sprite sheets (32x32, 4 directions x 4 frames)
  - [ ] J.A.R.V.I.S.
  - [ ] F.R.I.D.A.Y.
  - [ ] Bumblebee
  - [ ] Cursor
  - [ ] Claude
  - [ ] Claude Code
  - [ ] Claude Cowork
  - [ ] Grok
  - [ ] Gemini
  - [ ] Apple Intelligence
- [ ] Tileset for HQ room
  - [ ] Floor tiles
  - [ ] Wall tiles
  - [ ] Furniture (desks, computers, servers)
  - [ ] Decorations (plants, posters, lights)
- [ ] UI elements
  - [ ] Pokemon-style text box
  - [ ] Menu frames
  - [ ] Status icons

### Code Changes
- [ ] Replace programmatic sprites with PNG loader
- [ ] Add tile-based map rendering
- [ ] Pokemon-style text boxes for agent dialogue
- [ ] Proper GBA color palette

## Phase 2: Real Agent Connections

### API Integrations
- [ ] Connect to actual Cursor agent
- [ ] Claude API integration
- [ ] Gemini API integration
- [ ] Apple Intelligence (local Siri?)
- [ ] Grok API (X API)

### Features
- [ ] Real task submission to agents
- [ ] Live status from actual services
- [ ] Response display in text boxes
- [ ] Agent "speaking" animations

## Phase 3: Enhanced Gameplay

### Features
- [ ] Multiple rooms/areas (different teams)
- [ ] Agent pathfinding (A*)
- [ ] Interaction zones (click to talk)
- [ ] Task history log
- [ ] Agent stats/profiles

### Polish
- [ ] Sound effects
- [ ] Background music
- [ ] Screen transitions
- [ ] Save/load state

## Asset Resources

### Free Pokemon-Style Assets
- OpenGameArt.org - Search "RPG" or "top-down"
- itch.io - Many free GBA-style tilesets
- Spriters Resource - Reference for style

### Tools
- **Aseprite** ($20) - Best pixel art editor
- **Piskel** (Free) - Web-based sprite editor
- **Tiled** (Free) - Map editor
- **GIMP** (Free) - General image editing

## Notes

Drop your assets in `/public/assets/` following the structure in `assets/README.md`.
The game will auto-detect custom sprites and use them instead of the programmatic ones.
