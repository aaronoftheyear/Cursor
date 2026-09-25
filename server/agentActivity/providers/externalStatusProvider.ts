/**
 * Watches set-agent-status.sh output (.dashboard/external-agents.json).
 */

import fs from 'node:fs'
import path from 'node:path'
import type { AgentActivityProvider, AgentEvent, AgentActivityKind } from '../types'

const POLL_MS = 2000

export class ExternalStatusProvider implements AgentActivityProvider {
  readonly id = 'external-script'
  private timer: ReturnType<typeof setInterval> | null = null
  private lastSnapshot = ''

  constructor(private readonly projectRoot: string) {}

  private externalPath(): string {
    return path.join(this.projectRoot, '.dashboard', 'external-agents.json')
  }

  start(emit: (event: AgentEvent) => void): void {
    const poll = () => {
      const file = this.externalPath()
      let raw = ''
      try {
        raw = fs.readFileSync(file, 'utf-8')
      } catch {
        return
      }
      if (raw === this.lastSnapshot) return
      this.lastSnapshot = raw
      let data: { agents?: Record<string, Record<string, unknown>> }
      try {
        data = JSON.parse(raw) as { agents?: Record<string, Record<string, unknown>> }
      } catch {
        return
      }
      const agents = data.agents || {}
      for (const [agentId, entry] of Object.entries(agents)) {
        const status = String(entry.status || 'idle')
        const activity = entry.activity as AgentActivityKind | undefined
        emit({
          id: `external:${agentId}:${entry.updatedAt || Date.now()}`,
          ts: Date.now(),
          source: 'external-script',
          providerId: this.id,
          agentId,
          kind: status === 'idle' ? 'idle' : 'activity',
          status: status as 'idle' | 'working' | 'busy',
          activity,
          activityDepth: entry.activityDepth as 'brief' | 'deep' | undefined,
          detail: typeof entry.detail === 'string' ? entry.detail : undefined,
        })
      }
    }
    poll()
    this.timer = setInterval(poll, POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
