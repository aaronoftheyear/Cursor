# AI Agent Dashboard

A retro pixel-art dashboard where AI agents walk around like characters in an old-school game. Features JEV-style task orchestration to automatically route tasks to the best-suited agent.

![Dashboard Preview](docs/preview.png)

## Features

- **Pixel Art Agents**: Watch Cursor, Grok, Claude, Claude Cowork, Claude Code, Gemini, and Apple Intelligence walk around your virtual HQ
- **JEV-Style Orchestration**: Automatically routes tasks to the most suitable agent based on keywords and specialties
- **Real-time Status**: See which agents are idle, working, or offline
- **Task Queue**: Track pending and completed tasks
- **Native Mac App**: Runs as a native Electron app on your Mac Studio

## Agents

| Agent | Specialties |
|-------|-------------|
| **Cursor** | IDE integration, code editing, refactoring, autocomplete |
| **Grok** | Real-time info, social media, current events, humor |
| **Claude** | Analysis, writing, research, reasoning, ethics |
| **Claude Cowork** | Team collaboration, multi-agent coordination, handoffs |
| **Claude Code** | Software development, architecture, debugging, git |
| **Gemini** | Multimodal, images, search, data analysis |
| **Apple Intelligence** | Privacy, on-device processing, Siri, Apple ecosystem |

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server (web)
npm run dev

# Start Electron app (Mac)
npm run electron:dev
```

### Building for Production

```bash
# Build web version
npm run build

# Build and run Electron app
npm run electron
```

## Task Orchestration with Laya

The dashboard uses **Laya** - the open-source, self-hosted alternative to Jev - for intelligent task routing. Laya provides:

- **AI-powered decisions** with calibrated confidence scores
- **~32ms latency** (vs ~250ms for hosted Jev)
- **100% free** and self-hosted
- **Multilingual support** (100+ languages)

### Setting Up Laya

```bash
# Install Laya
pip install laya-mcp

# Start the Laya server (keeps model warm)
laya-mcp serve

# The dashboard will auto-detect Laya at http://127.0.0.1:8787
```

When Laya is running, the status bar shows "🧠 LAYA". Without Laya, it falls back to keyword-based routing ("🔑 Keywords").

### Fallback Routing

If Laya is unavailable, the dashboard uses keyword matching:

- **Keywords**: Specific terms that map to agent capabilities
- **Weighted scoring**: Some matches are stronger indicators than others
- **Fallback logic**: If no clear match, defaults to Claude as general-purpose

### Example Routing

- "Debug this Python error" → **Claude Code** (debugging, code)
- "What's trending on Twitter?" → **Grok** (twitter, trending, real-time)
- "Analyze this image" → **Gemini** (image, multimodal)
- "Write a blog post about AI" → **Claude** (writing, analysis)
- "Process this locally for privacy" → **Apple Intelligence** (privacy, local)

## Architecture

```
src/
├── main.ts          # App entry point & UI logic
├── engine.ts        # Game loop & agent movement
├── renderer.ts      # Canvas rendering & pixel art
├── orchestrator.ts  # JEV-style task routing
├── agents.ts        # Agent configurations
├── sprites.ts       # Pixel art sprite definitions
└── types.ts         # TypeScript interfaces

electron/
└── main.js          # Electron main process
```

## Customization

### Adding New Agents

1. Add agent config to `src/agents.ts`
2. Add icon sprite to `src/sprites.ts`
3. Add routing rules to `src/orchestrator.ts`

### Modifying Routing Rules

Edit `ROUTING_RULES` in `src/orchestrator.ts` to adjust keyword weights and agent assignments.

## License

MIT
