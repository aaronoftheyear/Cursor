/**
 * Central activity feed: session-log fallback → dedupe → Python status pipeline.
 */

import { applyEventViaPython } from './applyViaPython'
import { shouldApplyLogFallbackEvent } from './hookDedupe'
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

function mapLogEventToCursor(
  event: AgentEvent
): { name: string; payload: Record<string, unknown> } | null {
  const sessionId = event.sessionId || 'log-session'
  const base: Record<string, unknown> = {
    session_id: sessionId,
    generation_id: event.id,
    timestamp: event.ts,
    source: 'claude-code',
    claude_code: true,
    agent_name: 'claude-code',
    workspace_roots: [],
  }

  switch (event.kind) {
    case 'sessionStart':
      return { name: 'sessionStart', payload: base }
    case 'sessionEnd':
    case 'turnEnd':
      return { name: event.kind === 'turnEnd' ? 'stop' : 'sessionEnd', payload: base }
    case 'permission':
      return {
        name: 'preToolUse',
        payload: { ...base, tool_name: 'askuserquestion' },
      }
    case 'activity':
      if (!event.activity) return null
      if (event.activity === 'thinking') {
        return { name: 'afterAgentThought', payload: base }
      }
      const toolMap: Record<string, string> = {
        reading: 'read',
        editing: 'edit',
        running: 'bash',
        researching: 'websearch',
        github: 'bash',
        planning: 'todowrite',
        waiting: 'askuserquestion',
      }
      const tool = toolMap[event.activity] || 'read'
      const payload: Record<string, unknown> = { ...base, tool_name: tool }
      if (event.activity === 'github') payload.command = 'git status'
      if (event.activity === 'running') payload.command = 'npm test'
      return { name: 'preToolUse', payload }
    default:
      return null
  }
}
