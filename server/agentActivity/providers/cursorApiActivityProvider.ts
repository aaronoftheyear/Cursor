/**
 * Cursor Cloud API polling as an AgentActivityProvider (wraps vite merge targets).
 */

import type { AgentActivityProvider, AgentEvent } from '../types'

const POLL_MS = 30_000

export interface CursorApiProviderOptions {
  apiKey?: string
  agentNameHints?: Record<string, string[]>
}

export class CursorApiActivityProvider implements AgentActivityProvider {
  readonly id = 'cursor-api'
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: CursorApiProviderOptions = {}) {}

  start(emit: (event: AgentEvent) => void): void {
    const poll = async () => {
      const apiKey = this.options.apiKey || process.env.CURSOR_API_KEY
      if (!apiKey) return
      try {
        const res = await fetch(
          'https://api.cursor.com/v1/agents?limit=50&includeArchived=false',
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
          }
        )
        if (!res.ok) return
        const data = (await res.json()) as {
          items: Array<{ id: string; name?: string; latestRunId?: string }>
        }
        const hints = this.options.agentNameHints || {}
        for (const agent of data.items || []) {
          const nameLower = (agent.name || '').toLowerCase()
          let avatarId: string | null = null
          for (const [id, nameHints] of Object.entries(hints)) {
            for (const hint of nameHints) {
              if (nameLower.includes(hint.toLowerCase())) {
                avatarId = id
                break
              }
            }
            if (avatarId) break
          }
          if (!avatarId) continue

          let status: 'idle' | 'working' = 'idle'
          if (agent.latestRunId) {
            const runRes = await fetch(
              `https://api.cursor.com/v1/agents/${agent.id}/runs/${agent.latestRunId}`,
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
              }
            )
            if (runRes.ok) {
              const run = (await runRes.json()) as { status: string }
              if (run.status === 'RUNNING' || run.status === 'CREATING') status = 'working'
            }
          }

          emit({
            id: `cursor-api:${avatarId}:${agent.id}:${status}`,
            ts: Date.now(),
            source: 'cursor-api',
            providerId: this.id,
            agentId: avatarId,
            kind: status === 'working' ? 'activity' : 'idle',
            status,
            activity: status === 'working' ? 'thinking' : undefined,
            activityDepth: status === 'working' ? 'deep' : undefined,
            detail: status === 'working' ? 'Cloud agent running' : 'Cloud agent idle',
          })
        }
      } catch {
        /* ignore network errors */
      }
    }
    poll()
    this.timer = setInterval(() => void poll(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
