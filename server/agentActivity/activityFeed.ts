/**
 * Central activity feed: providers → dedupe → Python status pipeline.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { applyEventViaPython } from './applyViaPython'
import { claudeHookToAgentEvent } from './claudeHookBridge'
import { shouldApplyLogFallbackEvent } from './hookDedupe'
import { ClaudeSessionLogProvider } from './providers/claudeSessionLogProvider'
import { CursorApiActivityProvider } from './providers/cursorApiActivityProvider'
import { ExternalStatusProvider } from './providers/externalStatusProvider'
import type { AgentActivityProvider, AgentEvent } from './types'
import { SOURCE_PRIORITY } from './types'

export interface ActivityFeedOptions {
  projectRoot: string
  cursorApiKey?: string
  agentNameHints?: Record<string, string[]>
  extraProviders?: AgentActivityProvider[]
}

export class ActivityFeed {
  private readonly providers: AgentActivityProvider[] = []
  private readonly recentIds = new Set<string>()
  private running = false

  constructor(private readonly options: ActivityFeedOptions) {
    const root = options.projectRoot
    this.providers.push(new ClaudeSessionLogProvider(root))
    this.providers.push(new ExternalStatusProvider(root))
    this.providers.push(
      new CursorApiActivityProvider({
        apiKey: options.cursorApiKey,
        agentNameHints: options.agentNameHints,
      })
    )
    if (options.extraProviders) this.providers.push(...options.extraProviders)
  }

  private handleEvent(event: AgentEvent): void {
    if (!shouldApplyLogFallbackEvent(this.options.projectRoot, event)) return
    if (this.recentIds.has(event.id)) return
    this.recentIds.add(event.id)
    if (this.recentIds.size > 500) {
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

  ingestClaudeHook(raw: Record<string, unknown>): void {
    const event = claudeHookToAgentEvent(raw)
    if (event) this.handleEvent(event)
  }

  /** HTTP handler for optional hook POST (pixtuoid-style fire-and-forget target). */
  createHookMiddleware(): (req: IncomingMessage, res: ServerResponse) => void {
    return (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        try {
          const raw = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<
            string,
            unknown
          >
          this.ingestClaudeHook(raw)
          res.statusCode = 204
        } catch {
          res.statusCode = 400
        }
        res.end()
      })
    }
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
      const toolMap: Record<string, string> = {
        reading: 'read',
        editing: 'edit',
        running: 'bash',
        researching: 'websearch',
        github: 'bash',
        planning: 'todowrite',
        thinking: 'task',
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

export function loadAgentNameHints(projectRoot: string): Record<string, string[]> {
  const linksPath = path.join(projectRoot, 'public', 'assets', 'agent-links.json')
  try {
    const data = JSON.parse(fs.readFileSync(linksPath, 'utf-8')) as {
      agents?: Record<string, { cloud?: { agentNameContains?: string[] }; cursor?: { agentNameContains?: string[] } }>
    }
    const out: Record<string, string[]> = {}
    for (const [id, spec] of Object.entries(data.agents || {})) {
      const hints = spec.cloud?.agentNameContains || spec.cursor?.agentNameContains
      if (hints?.length) out[id] = hints
    }
    return out
  } catch {
    return {}
  }
}

export function compareEventPriority(a: AgentEvent, b: AgentEvent): number {
  return SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]
}
