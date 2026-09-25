import fs from 'node:fs'
import path from 'node:path'
import type { Connect } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import {
  mergeExternalAgents,
  createUpdatedAtState,
  computeUpdatedAt,
  type AgentStatus,
  type LiveStatus,
  type ExternalAgents,
  type CloudAgentStatus,
} from './server/liveStatusMerge'
import { ActivityFeed } from './server/agentActivity/activityFeed'

const CURSOR_STALE_MS = 300_000 // 5 minutes - self-healing for stuck agents
const DEFAULT_AGENTS = ['jarvis', 'friday', 'bumblebee', 'claude-code'] as const

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

// Cloud agent poller state
let cloudAgentCache: Map<string, CloudAgentStatus> = new Map()
// Separate cache for all cloud agents by bc-id (for waiting-on checks)
let cloudAgentByIdCache: Map<string, CloudAgentStatus> = new Map()
let cloudPollTime = 0
const CLOUD_POLL_INTERVAL_MS = 30_000

let dashboardActivityFeed: ActivityFeed | null = null

/** @internal Tests: feed must stay running after Vite configureServer returns. */
export function getDashboardActivityFeedForTests(): ActivityFeed | null {
  return dashboardActivityFeed
}

// Track last sent response for updatedAt comparison
const updatedAtState = createUpdatedAtState()

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
  /**
   * Reset agents to idle if they're stuck working with no recent events.
   * 
   * Only uses time-based staleness (lastEventAt). We do NOT use agentSessions
   * because Cursor fires 'stop' at the end of every turn (not per session),
   * so sessions can be 0 while the agent is actively working on turn 2+.
   */
  const now = Date.now()
  const healed = { ...live, agents: { ...live.agents } }
  const lastEvents = live.lastEventAt || {}

  for (const agentId of DEFAULT_AGENTS) {
    const agent = healed.agents[agentId]
    if (!agent) continue
    if (agent.status !== 'working' && agent.status !== 'busy') continue
    if (agent.source === 'cloud-api' || agent.source === 'external') continue

    const lastEventTs = lastEvents[agentId]
    if (!lastEventTs) continue

    // lastEventTs is Unix seconds from Python, convert to ms
    const lastEventTime = typeof lastEventTs === 'number' 
      ? (lastEventTs < 1e12 ? lastEventTs * 1000 : lastEventTs) 
      : 0
    
    if (lastEventTime > 0 && now - lastEventTime > CURSOR_STALE_MS) {
      healed.agents[agentId] = defaultAgentStatus(agentId)
    }
  }

  return healed
}

async function pollCloudAgentsApi(config: AgentLinksConfig, apiKey: string | undefined): Promise<Map<string, CloudAgentStatus>> {
  if (!apiKey) {
    return new Map()
  }

  const now = Date.now()
  // Always cache for 30s, even when no agents match avatars
  if (now - cloudPollTime < CLOUD_POLL_INTERVAL_MS) {
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
      // Still update poll time to avoid hammering on errors
      cloudPollTime = now
      return cloudAgentCache
    }

    const data = await res.json() as { items: Array<{ id: string; name?: string; latestRunId?: string }> }
    const newCache = new Map<string, CloudAgentStatus>()
    const newIdCache = new Map<string, CloudAgentStatus>()

    for (const agent of data.items || []) {
      const agentName = agent.name || ''
      const agentNameLower = agentName.toLowerCase()
      let avatarId: string | null = null

      for (const [id, spec] of Object.entries(config.agents)) {
        if (id === 'jarvis') continue
        const cloudSpec = spec.cloud || spec.cursor
        if (!cloudSpec?.agentNameContains) continue
        for (const hint of cloudSpec.agentNameContains) {
          if (agentNameLower.includes(hint.toLowerCase())) {
            avatarId = id
            break
          }
        }
        if (avatarId) break
      }

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
        cloudAgentName: agentName,
      }
      if (runStatus === 'working') {
        status.activity = 'thinking'
        status.activityDepth = 'deep'
      }

      // Store in id cache for all agents (for waiting-on checks)
      newIdCache.set(agent.id, status)

      // Only store in avatar cache if it matches an avatar
      if (avatarId) {
        const existing = newCache.get(avatarId)
        if (!existing || (status.status === 'working' && existing.status !== 'working')) {
          newCache.set(avatarId, status)
        }
      }
    }

    cloudAgentCache = newCache
    cloudAgentByIdCache = newIdCache
    cloudPollTime = now
  } catch (err) {
    console.warn('[CloudAgentPoller] Poll failed:', err)
    // Update poll time on error to avoid tight retry loops
    cloudPollTime = now
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

function createLiveStatusMiddleware(cursorApiKey: string | undefined) {
  return async function liveStatusMiddleware(
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

    // Poll cloud agents first so we can use their status for waiting-on checks
    const cloudStatus = await pollCloudAgentsApi(linksConfig, cursorApiKey)

    // Merge external agents with cloud status for waiting-on auto-clear
    let merged = await mergeExternalAgents(live, external, cursorApiKey, cloudAgentByIdCache)

    // Finally merge cloud agent status
    merged = mergeCloudAgents(merged, cloudStatus)

    // Compute updatedAt (bumps on change, re-sends last on no-change)
    merged.updatedAt = computeUpdatedAt(merged.agents, updatedAtState)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(merged))
  }
}

export default defineConfig(({ mode }) => {
  // Load .env.local without VITE_ prefix requirement (empty prefix = all vars)
  const env = loadEnv(mode, process.cwd(), '')
  const cursorApiKey = env.CURSOR_API_KEY || undefined

  // Log cloud polling status at startup (never log the key itself)
  console.log(`[Dashboard] Cloud agent polling: ${cursorApiKey ? 'enabled' : 'disabled (no CURSOR_API_KEY)'}`)

  const liveStatusMiddleware = createLiveStatusMiddleware(cursorApiKey)

  return {
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
          dashboardActivityFeed = new ActivityFeed({ projectRoot: process.cwd() })
          dashboardActivityFeed.start()
          server.httpServer?.once('close', () => {
            dashboardActivityFeed?.stop()
            dashboardActivityFeed = null
          })
        },
        configurePreviewServer(server) {
          server.middlewares.use('/live-status.json', liveStatusMiddleware)
          dashboardActivityFeed = new ActivityFeed({ projectRoot: process.cwd() })
          dashboardActivityFeed.start()
          server.httpServer?.once('close', () => {
            dashboardActivityFeed?.stop()
            dashboardActivityFeed = null
          })
        },
      },
    ],
  }
})
