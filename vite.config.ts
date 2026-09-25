import fs from 'node:fs'
import path from 'node:path'
import type { Connect } from 'vite'
import { defineConfig } from 'vite'

const EXTERNAL_STALE_MS = 120_000 // 2 minutes
const CURSOR_STALE_MS = 300_000 // 5 minutes - self-healing for stuck agents
const DEFAULT_AGENTS = ['jarvis', 'friday', 'bumblebee'] as const

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
  agentSessions?: Record<string, number>
  lastEventAt?: Record<string, number>
  agents: Record<string, AgentStatus>
}

interface ExternalAgents {
  agents: Record<string, AgentStatus & { updatedAt?: string }>
}

interface AgentLinksConfig {
  version: number
  agents: Record<string, {
    label?: string
    cursor?: {
      payloadContains?: string[]
      agentNameContains?: string[]
    }
    cloud?: {
      agentNameContains?: string[]
    }
  }>
}

interface CloudAgentStatus {
  status: 'idle' | 'working' | 'busy'
  detail?: string
  activity?: string
  activityDepth?: 'brief' | 'deep'
  source: 'cloud-api'
  cloudAgentId?: string
  cloudRunStatus?: string
}

// Cloud agent poller state
let cloudAgentCache: Map<string, CloudAgentStatus> = new Map()
let cloudPollTime = 0
const CLOUD_POLL_INTERVAL_MS = 30_000

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function defaultAgentStatus(agentId: string): AgentStatus {
  const labels: Record<string, string> = {
    jarvis: 'Waiting for Cursor session',
    friday: 'Waiting for F.R.I.D.A.Y. session',
    bumblebee: 'Waiting for Bumblebee session',
  }
  return {
    status: 'idle',
    source: 'cursor',
    detail: labels[agentId] || 'Idle',
  }
}

function healStaleAgents(live: LiveStatus): LiveStatus {
  const now = Date.now()
  const healed = { ...live, agents: { ...live.agents } }
  const sessions = live.agentSessions || {}
  const lastEvents = live.lastEventAt || {}

  for (const agentId of DEFAULT_AGENTS) {
    const agent = healed.agents[agentId]
    if (!agent) continue
    if (agent.status !== 'working' && agent.status !== 'busy') continue
    if (agent.source === 'cloud-api' || agent.source === 'external') continue

    const sessionCount = sessions[agentId] ?? 0
    const lastEventTs = lastEvents[agentId]

    let isStale = false
    if (sessionCount <= 0) {
      isStale = true
    } else if (lastEventTs) {
      const lastEventTime = typeof lastEventTs === 'number' ? lastEventTs * 1000 : lastEventTs
      if (now - lastEventTime > CURSOR_STALE_MS) {
        isStale = true
      }
    }

    if (isStale) {
      healed.agents[agentId] = defaultAgentStatus(agentId)
    }
  }

  return healed
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

async function pollCloudAgentsApi(config: AgentLinksConfig): Promise<Map<string, CloudAgentStatus>> {
  const apiKey = process.env.CURSOR_API_KEY
  if (!apiKey) {
    return new Map()
  }

  const now = Date.now()
  if (now - cloudPollTime < CLOUD_POLL_INTERVAL_MS && cloudAgentCache.size > 0) {
    return cloudAgentCache
  }

  try {
    const res = await fetch('https://api.cursor.com/v1/agents?limit=50&includeArchived=false', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.warn('[CloudAgentPoller] Invalid CURSOR_API_KEY or insufficient permissions')
      }
      return cloudAgentCache
    }

    const data = await res.json() as { items: Array<{ id: string; name?: string; latestRunId?: string }> }
    const newCache = new Map<string, CloudAgentStatus>()

    for (const agent of data.items || []) {
      const agentName = (agent.name || '').toLowerCase()
      let avatarId: string | null = null

      for (const [id, spec] of Object.entries(config.agents)) {
        if (id === 'jarvis') continue
        const cloudSpec = spec.cloud || spec.cursor
        if (!cloudSpec?.agentNameContains) continue
        for (const hint of cloudSpec.agentNameContains) {
          if (agentName.includes(hint.toLowerCase())) {
            avatarId = id
            break
          }
        }
        if (avatarId) break
      }

      if (!avatarId) continue

      let runStatus: 'idle' | 'working' = 'idle'
      let detail = 'Cloud agent idle'

      if (agent.latestRunId) {
        try {
          const runRes = await fetch(
            `https://api.cursor.com/v1/agents/${agent.id}/runs/${agent.latestRunId}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
            }
          )
          if (runRes.ok) {
            const run = await runRes.json() as { status: string; result?: string }
            if (run.status === 'RUNNING' || run.status === 'CREATING') {
              runStatus = 'working'
              detail = run.status === 'CREATING' ? 'Starting cloud agent...' : 'Cloud agent running'
            } else if (run.status === 'FINISHED') {
              detail = run.result ? `Finished: ${run.result.slice(0, 40)}` : 'Finished'
            } else {
              detail = `Run ${run.status.toLowerCase()}`
            }
          }
        } catch {
          // Ignore run fetch errors
        }
      }

      const status: CloudAgentStatus = {
        status: runStatus,
        detail,
        source: 'cloud-api',
        cloudAgentId: agent.id,
      }
      if (runStatus === 'working') {
        status.activity = 'thinking'
        status.activityDepth = 'deep'
      }

      const existing = newCache.get(avatarId)
      if (!existing || (status.status === 'working' && existing.status !== 'working')) {
        newCache.set(avatarId, status)
      }
    }

    cloudAgentCache = newCache
    cloudPollTime = now
  } catch (err) {
    console.warn('[CloudAgentPoller] Poll failed:', err)
  }

  return cloudAgentCache
}

function mergeCloudAgents(live: LiveStatus, cloudStatus: Map<string, CloudAgentStatus>): LiveStatus {
  if (cloudStatus.size === 0) return live

  const merged = { ...live, agents: { ...live.agents } }

  for (const [agentId, status] of cloudStatus) {
    const existing = merged.agents[agentId]
    if (existing?.source === 'cursor' && existing.status === 'working') {
      continue
    }
    if (existing?.source === 'external' && existing.status !== 'idle') {
      continue
    }
    merged.agents[agentId] = status as unknown as AgentStatus
  }

  return merged
}

async function liveStatusMiddleware(
  _req: Connect.IncomingMessage,
  res: Connect.ServerResponse,
  _next: Connect.NextFunction
): Promise<void> {
  const livePath = path.join(process.cwd(), '.dashboard', 'live-status.json')
  const publicPath = path.join(process.cwd(), 'public', 'live-status.json')
  const externalPath = path.join(process.cwd(), '.dashboard', 'external-agents.json')
  const linksPath = path.join(process.cwd(), 'public', 'assets', 'agent-links.json')

  const liveFile = fs.existsSync(livePath) ? livePath : publicPath
  let live = readJsonSafe<LiveStatus>(liveFile, { agents: {}, activeSessions: 0 })
  const external = readJsonSafe<ExternalAgents>(externalPath, { agents: {} })
  const linksConfig = readJsonSafe<AgentLinksConfig>(linksPath, { version: 1, agents: {} })

  live = healStaleAgents(live)

  let merged = mergeExternalAgents(live, external)

  const cloudStatus = await pollCloudAgentsApi(linksConfig)
  merged = mergeCloudAgents(merged, cloudStatus)

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
