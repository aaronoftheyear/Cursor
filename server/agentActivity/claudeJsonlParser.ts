/**
 * Parse Claude Code session JSONL (pixel-agents transcriptParser, MIT).
 */

import { activityFromToolName } from './toolMapping'
import type { AgentEvent } from './types'

export interface JsonlParseContext {
  sessionId: string
  filePath: string
  byteOffset: number
}

export interface ClaudeJsonlSessionState {
  sessionStarted: boolean
  hadToolsInTurn: boolean
}

const PERMISSION_EXEMPT_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'Task',
  'Agent',
])

/** Map subagent sidecar logs to parent session for hook dedupe. */
export function sessionIdFromJsonlPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const subagentMatch = normalized.match(/\/([^/]+)\/subagents\/agent-[^/]+\.jsonl$/i)
  if (subagentMatch) return subagentMatch[1]
  const base = normalized.split('/').pop() || 'unknown'
  return base.replace(/\.jsonl$/i, '') || 'unknown'
}

function eventId(
  ctx: JsonlParseContext,
  record: Record<string, unknown>,
  suffix: string
): string {
  const uuid = typeof record.uuid === 'string' ? record.uuid : ''
  if (uuid) return `${ctx.sessionId}:${uuid}`
  return `${ctx.filePath}@${ctx.byteOffset}:${suffix}`
}

function baseEvent(ctx: JsonlParseContext, _record: Record<string, unknown>) {
  return {
    ts: Date.now(),
    source: 'claude-session-log' as const,
    providerId: 'claude-session-log',
    agentId: 'claude-code',
    sessionId: ctx.sessionId,
  }
}

function maybeSessionStart(
  state: ClaudeJsonlSessionState,
  ctx: JsonlParseContext,
  record: Record<string, unknown>
): AgentEvent[] {
  if (state.sessionStarted) return []
  state.sessionStarted = true
  const base = baseEvent(ctx, record)
  return [
    {
      ...base,
      id: eventId(ctx, record, `sessionStart:${record.uuid || 'start'}`),
      kind: 'sessionStart',
      status: 'working',
      activity: 'planning',
      activityDepth: 'brief',
      detail: 'Claude Code session (log)',
    },
  ]
}

export function parseClaudeJsonlLine(
  line: string,
  ctx: JsonlParseContext,
  state: ClaudeJsonlSessionState
): { events: AgentEvent[]; schedulePermissionTimer: boolean } {
  const trimmed = line.trim()
  if (!trimmed) return { events: [], schedulePermissionTimer: false }

  let record: Record<string, unknown>
  try {
    record = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return { events: [], schedulePermissionTimer: false }
  }

  const type = record.type
  const base = baseEvent(ctx, record)
  const events: AgentEvent[] = []
  let schedulePermissionTimer = false

  if (type === 'system' && record.subtype === 'turn_duration') {
    state.hadToolsInTurn = false
    events.push({
      ...base,
      id: eventId(ctx, record, 'turnEnd'),
      kind: 'turnEnd',
      status: 'idle',
      detail: 'Claude Code — turn complete',
    })
    return { events, schedulePermissionTimer: false }
  }

  if (type === 'system') {
    return { events, schedulePermissionTimer: false }
  }

  const assistantContent =
    (record.message as { content?: unknown })?.content ?? record.content

  if (type === 'assistant' && Array.isArray(assistantContent)) {
    events.push(...maybeSessionStart(state, ctx, record))
    const blocks = assistantContent as Array<{
      type?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
    }>
    for (const block of blocks) {
      if (block.type === 'thinking') {
        events.push({
          ...base,
          id: eventId(ctx, record, `think:${block.id || 'block'}`),
          kind: 'activity',
          status: 'working',
          activity: 'thinking',
          activityDepth: 'deep',
          detail: 'Claude Code — Thinking',
        })
      }
    }

    const hasToolUse = blocks.some((b) => b.type === 'tool_use')
    if (hasToolUse) {
      state.hadToolsInTurn = true
      let hasNonExempt = false
      for (const block of blocks) {
        if (block.type === 'tool_use' && block.id && block.name) {
          const command =
            typeof block.input?.command === 'string' ? block.input.command : undefined
          const activity = activityFromToolName(block.name, command)
          events.push({
            ...base,
            id: eventId(ctx, record, `tool:${block.id}`),
            kind: 'activity',
            status: 'working',
            activity,
            activityDepth:
              activity === 'researching' || activity === 'github' ? 'deep' : 'brief',
            detail: `Claude Code — ${activity}`,
          })
          if (!PERMISSION_EXEMPT_TOOLS.has(block.name)) hasNonExempt = true
        }
      }
      schedulePermissionTimer = hasNonExempt
      return { events, schedulePermissionTimer }
    }

    if (blocks.some((b) => b.type === 'text') && !state.hadToolsInTurn) {
      events.push({
        ...base,
        id: eventId(ctx, record, 'textIdle'),
        kind: 'activity',
        status: 'working',
        activity: 'thinking',
        activityDepth: 'brief',
        detail: 'Claude Code — Thinking',
      })
    }
    return { events, schedulePermissionTimer: false }
  }

  if (type === 'user') {
    const content = (record.message as { content?: unknown })?.content ?? record.content
    if (Array.isArray(content)) {
      const hasToolResult = content.some(
        (b) => b && typeof b === 'object' && (b as { type?: string }).type === 'tool_result'
      )
      if (hasToolResult) {
        return { events: [], schedulePermissionTimer: false }
      }
      const hasToolUseResult = record.toolUseResult !== undefined
      if (hasToolUseResult) {
        return { events: [], schedulePermissionTimer: false }
      }
    }
    if (typeof content === 'string' && content.trim()) {
      events.push(...maybeSessionStart(state, ctx, record))
      state.hadToolsInTurn = false
    }
    return { events, schedulePermissionTimer: false }
  }

  if (type === 'progress') {
    return { events, schedulePermissionTimer: false }
  }

  return { events, schedulePermissionTimer: false }
}
