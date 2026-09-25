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

export interface JsonlParseResult {
  events: AgentEvent[]
  schedulePermissionTimer: boolean
  cancelPermissionTimer: boolean
  refreshPermissionTimer: boolean
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

function blockEventId(
  ctx: JsonlParseContext,
  record: Record<string, unknown>,
  blockKey: string
): string {
  const uuid = typeof record.uuid === 'string' ? record.uuid : ''
  if (uuid) return `${ctx.sessionId}:${uuid}:${blockKey}`
  return `${ctx.filePath}@${ctx.byteOffset}:${blockKey}`
}

function baseEvent(ctx: JsonlParseContext) {
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
  const base = baseEvent(ctx)
  return [
    {
      ...base,
      id: blockEventId(ctx, record, 'sessionStart'),
      kind: 'sessionStart',
      status: 'working',
      activity: 'planning',
      activityDepth: 'brief',
      detail: 'Claude Code session (log)',
    },
  ]
}

function userHasTextPrompt(content: unknown): boolean {
  if (typeof content === 'string') return content.trim().length > 0
  if (!Array.isArray(content)) return false
  return content.some(
    (b) =>
      b &&
      typeof b === 'object' &&
      (b as { type?: string }).type === 'text' &&
      typeof (b as { text?: string }).text === 'string' &&
      (b as { text: string }).text.trim().length > 0
  )
}

export function parseClaudeJsonlLine(
  line: string,
  ctx: JsonlParseContext,
  state: ClaudeJsonlSessionState
): JsonlParseResult {
  const empty: JsonlParseResult = {
    events: [],
    schedulePermissionTimer: false,
    cancelPermissionTimer: false,
    refreshPermissionTimer: false,
  }
  const trimmed = line.trim()
  if (!trimmed) return empty

  let record: Record<string, unknown>
  try {
    record = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return empty
  }

  const type = record.type
  const base = baseEvent(ctx)
  const events: AgentEvent[] = []
  let schedulePermissionTimer = false
  let cancelPermissionTimer = false
  let refreshPermissionTimer = false

  if (type === 'system' && record.subtype === 'turn_duration') {
    state.hadToolsInTurn = false
    events.push({
      ...base,
      id: blockEventId(ctx, record, 'turnEnd'),
      kind: 'turnEnd',
      status: 'idle',
      detail: 'Claude Code — turn complete',
    })
    return { events, schedulePermissionTimer, cancelPermissionTimer, refreshPermissionTimer }
  }

  if (type === 'system') {
    return empty
  }

  if (type === 'progress') {
    const subtype = record.subtype
    if (subtype === 'bash_progress' || record.tool_use_id) {
      refreshPermissionTimer = true
    }
    return { events, schedulePermissionTimer, cancelPermissionTimer, refreshPermissionTimer }
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

    blocks.forEach((block, blockIndex) => {
      if (block.type === 'thinking') {
        events.push({
          ...base,
          id: blockEventId(ctx, record, `thinking:${blockIndex}`),
          kind: 'activity',
          status: 'working',
          activity: 'thinking',
          activityDepth: 'deep',
          detail: 'Claude Code — Thinking',
        })
      }
    })

    const toolBlocks = blocks.filter((b) => b.type === 'tool_use' && b.id && b.name)
    if (toolBlocks.length > 0) {
      state.hadToolsInTurn = true
      let hasNonExempt = false
      toolBlocks.forEach((block, toolIndex) => {
        const command =
          typeof block.input?.command === 'string' ? block.input.command : undefined
        const activity = activityFromToolName(block.name!, command)
        events.push({
          ...base,
          id: blockEventId(ctx, record, `tool:${block.id ?? toolIndex}`),
          kind: 'activity',
          status: 'working',
          activity,
          activityDepth:
            activity === 'researching' || activity === 'github' ? 'deep' : 'brief',
          detail: `Claude Code — ${activity}`,
        })
        if (!PERMISSION_EXEMPT_TOOLS.has(block.name!)) hasNonExempt = true
      })
      schedulePermissionTimer = hasNonExempt
      return { events, schedulePermissionTimer, cancelPermissionTimer, refreshPermissionTimer }
    }

    if (blocks.some((b) => b.type === 'text') && !state.hadToolsInTurn) {
      events.push({
        ...base,
        id: blockEventId(ctx, record, 'text:0'),
        kind: 'activity',
        status: 'working',
        activity: 'thinking',
        activityDepth: 'brief',
        detail: 'Claude Code — Thinking',
      })
    }
    return { events, schedulePermissionTimer, cancelPermissionTimer, refreshPermissionTimer }
  }

  if (type === 'user') {
    const content = (record.message as { content?: unknown })?.content ?? record.content
    if (Array.isArray(content)) {
      const hasToolResult = content.some(
        (b) => b && typeof b === 'object' && (b as { type?: string }).type === 'tool_result'
      )
      if (hasToolResult) {
        cancelPermissionTimer = true
        return { events, schedulePermissionTimer, cancelPermissionTimer, refreshPermissionTimer }
      }
    }
    if (record.toolUseResult !== undefined) {
      cancelPermissionTimer = true
      return { events, schedulePermissionTimer, cancelPermissionTimer, refreshPermissionTimer }
    }
    if (userHasTextPrompt(content)) {
      events.push(...maybeSessionStart(state, ctx, record))
      state.hadToolsInTurn = false
    }
    return { events, schedulePermissionTimer, cancelPermissionTimer, refreshPermissionTimer }
  }

  return empty
}
