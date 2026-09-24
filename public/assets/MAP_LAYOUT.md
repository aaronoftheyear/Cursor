# AI Agent HQ - Map Layout

Based on your sketch:

```
┌─────────────────┬─────────────────────────┬─────────────────┐
│                 │                         │                 │
│   CURSOR HQ     │                         │   CLAUDE HQ     │
│                 │                         │                 │
│  ┌───┐   ┌───┐  │                         │  ┌───┐   ┌───┐  │
│  │PC │   │PC │  │                         │  │PC │   │PC │  │
│  └───┘   └───┘  │                         │  └───┘   └───┘  │
│                 │                         │                 │
│   J.A.R.V.I.S.  │                         │     Claude      │
│                 │                         │                 │
│  Cursor    Bee  │                         │  Code   Cowork  │
│                 │                         │                 │
│  🌿             │                         │             🌿  │
│       ╔═══╗     │                         │     ╔═══╗       │
└───────╢   ╟─────┴─────────────────────────┴─────╢   ╟───────┘
        ╚═══╝                                     ╚═══╝
           │                                         │
           ▼                                         ▼
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  🌳        OUTSIDE / MAIN SPACE                       🌳    │
│                                                              │
│       Grok      Gemini    F.R.I.D.A.Y.    Apple             │
│                    ⛲                                        │
│         ═══════════════════════════════                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Rooms

| Room | Size | Agents | Style |
|------|------|--------|-------|
| **Cursor HQ** | 10x14 tiles | J.A.R.V.I.S., Cursor, Bumblebee | Tech lab, blue tones |
| **Claude HQ** | 10x14 tiles | Claude, Claude Code, Claude Cowork | Office, orange/warm tones |
| **Main Space** | 30x6 tiles | F.R.I.D.A.Y., Grok, Gemini, Apple Intelligence | Outdoor plaza, neutral |

## Assets Needed Per Room

### Cursor HQ (Indoor Tech Lab)
- Floor: Tech/metallic tiles
- Walls: Modern/glass
- Furniture: Computer desks, servers, monitors
- Decorations: Code posters, plants

### Claude HQ (Indoor Office)
- Floor: Wood/carpet
- Walls: Warm office walls
- Furniture: Desks, bookshelves, computers
- Decorations: Plants, art

### Main Space (Outdoor Plaza)
- Floor: Stone/path tiles
- Features: Trees, benches, fountain
- No walls (open area)

## Agent Placement

```
CURSOR HQ:
  J.A.R.V.I.S. = Center (coordinator)
  Cursor = Left side (worker)
  Bumblebee = Right side (worker)

CLAUDE HQ:
  Claude = Center (main)
  Claude Code = Left side
  Claude Cowork = Right side

MAIN SPACE:
  F.R.I.D.A.Y. = Center (coordinator)
  Grok = Left area
  Gemini = Center-left
  Apple Intelligence = Right area
```

## Movement Rules

- Agents stay within their assigned room
- Agents can walk through doors to visit other rooms (optional feature)
- Coordinators tend to stay in center of their room
- Subagents wander around their coordinator
