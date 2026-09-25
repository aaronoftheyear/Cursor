import fs from 'node:fs'
import path from 'node:path'
import type { Connect } from 'vite'
import { defineConfig } from 'vite'

const EXTERNAL_STALE_MS = 120_000 // 2 minutes

interface AgentStatus {
  status: string
  detail?: string | null
  source?: string
  updatedAt?: string
  activity?: string
  activityDepth?: 'brief' | 'deep'
}

interface LiveStatus {
  updatedAt?: string
  activeSessions?: number
  activeTerminals?: number
  agents: Record<string, AgentStatus>
}

interface ExternalAgents {
  agents: Record<string, AgentStatus & { updatedAt?: string }>
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function mergeExternalAgents(live: LiveStatus, external: ExternalAgents): LiveStatus {
  const now = Date.now()
  const merged = { ...live, agents: { ...live.agents } }

  for (const [agentId, extStatus] of Object.entries(external.agents || {})) {
    if (!extStatus.updatedAt) continue

    const updatedAt = new Date(extStatus.updatedAt).getTime()
    const isStale = now - updatedAt > EXTERNAL_STALE_MS

    if (isStale) {
      merged.agents[agentId] = {
        status: 'idle',
        detail: 'External agent idle (stale)',
        source: 'external',
      }
    } else {
      const entry: AgentStatus = {
        status: extStatus.status,
        source: 'external',
      }
      if (extStatus.detail) entry.detail = extStatus.detail
      if (extStatus.activity) entry.activity = extStatus.activity
      if (extStatus.activityDepth) entry.activityDepth = extStatus.activityDepth
      merged.agents[agentId] = entry
    }
  }

  return merged
}

function liveStatusMiddleware(
  _req: Connect.IncomingMessage,
  res: Connect.ServerResponse,
  _next: Connect.NextFunction
): void {
  const livePath = path.join(process.cwd(), '.dashboard', 'live-status.json')
  const publicPath = path.join(process.cwd(), 'public', 'live-status.json')
  const externalPath = path.join(process.cwd(), '.dashboard', 'external-agents.json')

  const liveFile = fs.existsSync(livePath) ? livePath : publicPath
  const live = readJsonSafe<LiveStatus>(liveFile, { agents: {}, activeSessions: 0 })
  const external = readJsonSafe<ExternalAgents>(externalPath, { agents: {} })

  const merged = mergeExternalAgents(live, external)

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(merged))
}

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
  },
  plugins: [
    {
      name: 'dashboard-live-status',
      configureServer(server) {
        server.middlewares.use('/live-status.json', liveStatusMiddleware)
      },
      configurePreviewServer(server) {
        server.middlewares.use('/live-status.json', liveStatusMiddleware)
      },
    },
  ],
})
