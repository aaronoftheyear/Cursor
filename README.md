# AI Agent Dashboard

A retro pixel-art dashboard where AI agents walk around like characters in an old-school game. Features JEV-style task orchestration to automatically route tasks to the best-suited agent.

![Dashboard Preview](docs/preview.png)

## Features

- **Pixel Art Agents**: Watch AI agents walk around your virtual HQ
- **Cursor Projects Integration**: J.A.R.V.I.S. and F.R.I.D.A.Y. coordinators with subagents
- **Laya Orchestration**: Self-hosted JEV alternative for intelligent task routing
- **Real-time Status**: See which agents are idle, working, or offline
- **Task Queue**: Track pending and completed tasks
- **Agent Hierarchy**: Coordinators manage subagents with visual connection lines
- **Native Mac App**: Runs as a native Electron app on your Mac Studio

## Agents

### Coordinators (Cursor Projects)

| Agent | Role | Manages |
|-------|------|---------|
| **J.A.R.V.I.S.** | Local Coordinator | Cursor local agents, on-device development |
| **F.R.I.D.A.Y.** | Cloud Coordinator | Cloud troubleshooting, CI/CD, infrastructure |

### Subagents

| Agent | Reports To | Specialties |
|-------|------------|-------------|
| **Cursor** | J.A.R.V.I.S. | IDE integration, code editing, refactoring |
| **Bumblebee** | F.R.I.D.A.Y. | Log analysis, automated fixes, CI tasks |

### Standalone Agents

| Agent | Specialties |
|-------|-------------|
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

## External Agent Status

The dashboard can display live status for external agents (non-Cursor bots, desktop assistants, etc.) alongside Cursor-integrated agents. External agents use the **same activity vocabulary** as Cursor hooks, so they walk to matching action spots in the Main Space.

### Setting External Agent Status

Use the CLI script to report status from any shell command:

```bash
./scripts/set-agent-status.sh <agent-id> <status> [options]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `agent-id` | Yes | Agent identifier (e.g. `grokbot`, `gemini`, `apple-intelligence`) |
| `status` | Yes | One of: `idle`, `working`, `busy` |

**Options:**
| Option | Description |
|--------|-------------|
| `-a, --activity <activity>` | Activity type (required when status is working/busy) |
| `-d, --depth <depth>` | Activity depth: `brief` (stay at desk) or `deep` (walk to spot) |
| `-m, --message <text>` | Detail message shown in sidebar |
| `-h, --help` | Show help with all options |

### Activities (same as Cursor hooks)

These map to action spots in the game world:

| Activity | Description | Brief | Deep |
|----------|-------------|-------|------|
| `planning` | Planning, architecting, designing | Stays at computer | Walks to planning board |
| `thinking` | Thinking, reasoning, processing | Stays at computer | Walks to thinking spot |
| `reading` | Reading files, documentation | Stays at computer | Walks to bookshelf |
| `editing` | Editing files, coding | Stays at computer | Stays at computer |
| `running` | Running shell commands | Stays at computer | Stays at computer |
| `researching` | Web research, online search | Stays at computer | Walks to research TV/spot |
| `github` | GitHub ops, git push/pull/clone, gh CLI | Stays at computer | Walks to GitHub spot |

### Examples

```bash
# Grok is reading files (stays at computer)
./scripts/set-agent-status.sh grokbot working -a reading -m "Reading documentation"

# Grok is researching online (walks to research spot)
./scripts/set-agent-status.sh grokbot working -a researching -d deep -m "Searching Twitter trends"

# Grok is deeply thinking (walks to thinking spot)
./scripts/set-agent-status.sh grokbot working -a thinking -d deep

# Grok is running a command
./scripts/set-agent-status.sh grokbot working -a running -m "Fetching API data"

# Grok is using GitHub (walks to GitHub spot)
./scripts/set-agent-status.sh grokbot working -a github -d deep -m "Pushing to repo"

# Grok is planning something (walks to planning board)
./scripts/set-agent-status.sh grokbot working -a planning -d deep -m "Designing workflow"

# Grok is idle
./scripts/set-agent-status.sh grokbot idle
```

### How It Works

1. The script writes to `.dashboard/external-agents.json`
2. The Vite dev server merges this with Cursor hook status when serving `/live-status.json`
3. External agent status takes precedence over default idle state
4. The engine reads `activity` and `activityDepth` to pick the correct action spot
5. **Staleness:** If no update is received for 2 minutes, the agent reverts to idle

### Desktop Assistant Integration

For a Grok-based desktop assistant, add these calls:

```bash
# When starting web research
./scripts/set-agent-status.sh grokbot working -a researching -d deep -m "Researching: $QUERY"

# When reading files/docs
./scripts/set-agent-status.sh grokbot working -a reading -m "Reading: $FILE"

# When thinking deeply
./scripts/set-agent-status.sh grokbot working -a thinking -d deep

# When running a command
./scripts/set-agent-status.sh grokbot working -a running -m "Running: $CMD"

# When using GitHub
./scripts/set-agent-status.sh grokbot working -a github -d deep -m "Pushing: $BRANCH"

# When done
./scripts/set-agent-status.sh grokbot idle
```

The status file is written to `.dashboard/external-agents.json` and is not tracked by git.

## License

MIT
