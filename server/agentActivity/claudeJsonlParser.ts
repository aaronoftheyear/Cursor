/**
 * Parse Claude Code session JSONL lines into AgentEvents.
 * Borrowed from pixel-agents transcriptParser assistant/tool_use handling (MIT).
 */

import { activityFromToolName } from './toolMapping'
import type { AgentEvent } from './types'

export interface JsonlParseContext {
  sessionId: string
  filePath: string
  lineIndex: number
}

export function sessionIdFromJsonlPath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() || 'unknown'
  return base.replace(/\.jsonl$/i, '') || 'unknown'
}

export function parseClaudeJsonlLine(line: string, ctx: JsonlParseContext): AgentEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  let record: Record<string, unknown>
  try {
    record = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return []
  }

  const ts = Date.now()
  const base = {
    ts,
    source: 'claude-session-log' as const,
    providerId: 'claude-session-log',
    agentId: 'claude-code',
    sessionId: ctx.sessionId,
  }

  const type = record.type
  if (type === 'system' && record.subtype === 'init') {
    return [
      {
        ...base,
        id: `${ctx.sessionId}:init:${ctx.lineIndex}`,
        kind: 'sessionStart',
        status: 'working',
        activity: 'planning',
        activityDepth: 'brief',
        detail: 'Claude Code session (log)',
      },
    ]
  }

  if (type === 'assistant') {
    const content = (record.message as { content?: unknown })?.content ?? record.content
    if (!Array.isArray(content)) return []
    const events: AgentEvent[] = []
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as { type?: string; id?: string; name?: string; input?: Record<string, unknown> }
      if (b.type === 'tool_use' && b.id && b.name) {
        const command =
          typeof b.input?.command === 'string' ? b.input.command : undefined
        const activity = activityFromToolName(b.name, command)
        events.push({
          ...base,
          id: `${ctx.sessionId}:tool:${b.id}`,
          kind: 'activity',
          status: 'working',
          activity,
          activityDepth: activity === 'researching' || activity === 'github' ? 'deep' : 'brief',
          detail: `Claude Code — ${activity}`,
        })
      }
      if (b.type === 'thinking') {
        events.push({
          ...base,
          id: `${ctx.sessionId}:think:${ctx.lineIndex}`,
          kind: 'activity',
          status: 'working',
          activity: 'thinking',
          activityDepth: 'deep',
          detail: 'Claude Code — Thinking',
        })
      }
    }
    return events
  }

  if (type === 'user' && record.tool_use_result === undefined) {
    return [
      {
        ...base,
        id: `${ctx.sessionId}:user:${ctx.lineIndex}`,
        kind: 'activity',
        status: 'working',
        activity: 'thinking',
        activityDepth: 'brief',
        detail: 'Claude Code — Thinking',
      },
    ]
  }

  if (type === 'permission_request' || record.subtype === 'permission_prompt') {
    return [
      {
        ...base,
        id: `${ctx.sessionId}:perm:${ctx.lineIndex}`,
        kind: 'permission',
        status: 'working',
        activity: 'waiting',
        activityDepth: 'brief',
        detail: 'Claude Code — waiting for permission',
      },
    ]
  }

  return []
}
