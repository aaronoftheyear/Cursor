/**
 * Central activity feed: session-log fallback → dedupe → Python status pipeline.
 */

import { applyEventViaPython } from './applyViaPython'
import { shouldApplyLogFallbackEvent } from './hookDedupe'
import { mapLogEventToCursor } from './logToCursor'
import { ClaudeSessionLogProvider } from './providers/claudeSessionLogProvider'
import type { AgentActivityProvider, AgentEvent } from './types'

export interface ActivityFeedOptions {
  projectRoot: string
  extraProviders?: AgentActivityProvider[]
}

export class ActivityFeed {
  private readonly providers: AgentActivityProvider[] = []
  private readonly recentIds = new Set<string>()
  private running = false
  private sessionLog: ClaudeSessionLogProvider | null = null

  constructor(private readonly options: ActivityFeedOptions) {
    this.sessionLog = new ClaudeSessionLogProvider(options.projectRoot)
    this.providers.push(this.sessionLog)
    if (options.extraProviders) this.providers.push(...options.extraProviders)
  }

  isRunning(): boolean {
    return this.running
  }

  isSessionLogPolling(): boolean {
    return this.sessionLog?.isPolling() ?? false
  }

  private handleEvent(event: AgentEvent): void {
    if (!shouldApplyLogFallbackEvent(this.options.projectRoot, event)) return
    if (this.recentIds.has(event.id)) return
    this.recentIds.add(event.id)
    if (this.recentIds.size > 2000) {
      const first = this.recentIds.values().next().value
      if (first) this.recentIds.delete(first)
    }

    if (event.cursorEvent && event.hookPayload) {
      applyEventViaPython(this.options.projectRoot, event)
      return
    }

    if (event.source === 'claude-session-log') {
      const cursorEvent = mapLogEventToCursor(event)
      if (!cursorEvent) return
      applyEventViaPython(this.options.projectRoot, {
        ...event,
        cursorEvent: cursorEvent.name,
        hookPayload: cursorEvent.payload,
      })
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    for (const p of this.providers) {
      void p.start((ev) => this.handleEvent(ev))
    }
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    for (const p of this.providers) void p.stop()
  }
}
