/**
 * Live status merge logic for the dashboard middleware.
 * Extracted for testability - these functions handle external agent TTL expiry
 * and waiting-on cloud agent resolution.
 */

export const EXTERNAL_STALE_MS = 120_000 // 2 minutes

export interface AgentStatus {
  status: string
  detail?: string | null
  source?: string
  updatedAt?: string
  activity?: string
  activityDepth?: 'brief' | 'deep'
}

export interface LiveStatus {
  updatedAt?: string
  activeSessions?: number
  activeTerminals?: number
  agentSessions?: Record<string, number>
  lastEventAt?: Record<string, number>
  agents: Record<string, AgentStatus>
}

export interface ExternalAgentStatus extends AgentStatus {
  updatedAt?: string
  ttlSeconds?: number
  expiresAt?: string
  waitingOn?: string
}

export interface ExternalAgents {
  agents: Record<string, ExternalAgentStatus>
}

export interface CloudAgentStatus {
  status: 'idle' | 'working' | 'busy'
  detail?: string
  activity?: string
  activityDepth?: 'brief' | 'deep'
  source: 'cloud-api'
  cloudAgentId?: string
  cloudAgentName?: string
  cloudRunStatus?: string
}

// Cache for failed bc-id lookups (404s) - avoid repeated fetches
const failedBcIdCache = new Map<string, number>()
const FAILED_LOOKUP_CACHE_MS = 30_000

export type FetchFunction = typeof fetch

export async function fetchCloudAgentById(
  agentId: string,
  apiKey: string,
  fetchFn: FetchFunction = fetch
): Promise<CloudAgentStatus | null> {
  // Check if this bc-id recently failed
  const failedAt = failedBcIdCache.get(agentId)
  if (failedAt && Date.now() - failedAt < FAILED_LOOKUP_CACHE_MS) {
    return null
  }

  try {
    const res = await fetchFn(`https://api.cursor.com/v1/agents/${agentId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      // Cache 404s and other failures
      failedBcIdCache.set(agentId, Date.now())
      return null
    }

    const agent = await res.json() as { id: string; name?: string; latestRunId?: string }
    let runStatus: 'idle' | 'working' = 'idle'
    let detail = 'Cloud agent idle'

    if (agent.latestRunId) {
      const runRes = await fetchFn(
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
    }

    return {
      status: runStatus,
      detail,
      source: 'cloud-api',
      cloudAgentId: agent.id,
      cloudAgentName: agent.name || '',
    }
  } catch {
    // Cache fetch errors too
    failedBcIdCache.set(agentId, Date.now())
    return null
  }
}

export async function checkWaitingOnFinished(
  waitingOnId: string,
  apiKey: string | undefined,
  cloudAgentByIdCache: Map<string, CloudAgentStatus>,
  fetchFn: FetchFunction = fetch
): Promise<boolean> {
  const waitingOnLower = waitingOnId.toLowerCase().trim()
  
  // First check if it's a direct bc-ID reference
  if (waitingOnId.startsWith('bc-')) {
    // Check cache first
    let cloudAgent = cloudAgentByIdCache.get(waitingOnId)
    
    // If not in cache, fetch directly (for agents beyond first 50 or archived)
    if (!cloudAgent && apiKey) {
      cloudAgent = await fetchCloudAgentById(waitingOnId, apiKey, fetchFn) ?? undefined
      if (cloudAgent) {
        cloudAgentByIdCache.set(waitingOnId, cloudAgent)
      }
    }
    
    if (cloudAgent && cloudAgent.status === 'idle') {
      return true
    }
  }
  
  // Check by exact cloud agent ID match in the cache
  for (const [, cloudAgent] of cloudAgentByIdCache) {
    if (cloudAgent.cloudAgentId === waitingOnId) {
      if (cloudAgent.status === 'idle') {
        return true
      }
      return false
    }
  }
  
  // Check by name match - must be non-empty and case-insensitive exact match
  if (waitingOnLower) {
    for (const [, cloudAgent] of cloudAgentByIdCache) {
      const agentName = cloudAgent.cloudAgentName?.toLowerCase().trim()
      // Skip empty names - they should never match
      if (!agentName) continue
      // Case-insensitive exact match only
      if (agentName === waitingOnLower) {
        if (cloudAgent.status === 'idle') {
          return true
        }
        // Found matching agent but it's still running - don't clear
        return false
      }
    }
  }
  
  return false
}

export async function mergeExternalAgents(
  live: LiveStatus,
  external: ExternalAgents,
  apiKey: string | undefined,
  cloudAgentByIdCache: Map<string, CloudAgentStatus>,
  fetchFn: FetchFunction = fetch
): Promise<LiveStatus> {
  const now = Date.now()
  const merged = { ...live, agents: { ...live.agents } }

  for (const [agentId, extStatus] of Object.entries(external.agents || {})) {
    if (!extStatus.updatedAt) continue

    // Check if status has expired using custom TTL (expiresAt) or default
    let isStale = false
    if (extStatus.expiresAt) {
      const expiresAt = new Date(extStatus.expiresAt).getTime()
      isStale = now > expiresAt
    } else {
      const updatedAt = new Date(extStatus.updatedAt).getTime()
      isStale = now - updatedAt > EXTERNAL_STALE_MS
    }

    // Check if waiting-on cloud agent has finished
    let waitingOnFinished = false
    if (extStatus.waitingOn && !isStale) {
      waitingOnFinished = await checkWaitingOnFinished(
        extStatus.waitingOn,
        apiKey,
        cloudAgentByIdCache,
        fetchFn
      )
    }

    if (isStale || waitingOnFinished) {
      merged.agents[agentId] = {
        status: 'idle',
        detail: waitingOnFinished 
          ? `Cloud agent finished: ${extStatus.waitingOn}`
          : 'External agent idle (expired)',
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

// For testing: clear the failed lookup cache
export function clearFailedBcIdCache(): void {
  failedBcIdCache.clear()
}
