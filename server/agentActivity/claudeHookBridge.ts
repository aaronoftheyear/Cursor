/**
 * Normalize Claude Code hook payloads into AgentEvents (pixel-agents claude.ts, MIT).
 */

import type { AgentEvent } from './types'

const CLAUDE_TO_CURSOR: Record<string, string> = {
  SessionStart: 'sessionStart',
  UserPromptSubmit: 'beforeSubmitPrompt',
  PreToolUse: 'preToolUse',
  PostToolUse: 'postToolUse',
  Stop: 'stop',
  SessionEnd: 'sessionEnd',
}

const IGNORED = new Set(['SubagentStop', 'Notification', 'PreCompact'])

export function translateClaudePayload(claudePayload: Record<string, unknown>): Record<string, unknown> {
  const cursorPayload: Record<string, unknown> = {
    session_id: claudePayload.session_id,
    generation_id: `claude-${claudePayload.session_id}-${Date.now()}`,
    timestamp: Date.now(),
    workspace_roots: claudePayload.cwd ? [claudePayload.cwd] : [],
    source: 'claude-code',
    agent_name: 'claude-code',
    claude_code: true,
  }
  if (typeof claudePayload.tool_name === 'string') {
    cursorPayload.tool_name = claudePayload.tool_name.toLowerCase()
  }
  const toolInput = claudePayload.tool_input as Record<string, unknown> | undefined
  if (toolInput?.command) cursorPayload.command = toolInput.command
  const fp = toolInput?.file_path || toolInput?.path
  if (fp) cursorPayload.file_path = fp
  if (claudePayload.prompt) cursorPayload.prompt = claudePayload.prompt
  return cursorPayload
}

export function claudeHookToAgentEvent(raw: Record<string, unknown>): AgentEvent | null {
  const hookEventName = raw.hook_event_name
  if (typeof hookEventName !== 'string' || IGNORED.has(hookEventName)) return null
  const cursorEvent = CLAUDE_TO_CURSOR[hookEventName]
  if (!cursorEvent) return null
  const sessionId = typeof raw.session_id === 'string' ? raw.session_id : undefined
  const hookPayload = translateClaudePayload(raw)
  const id = `hook:${sessionId}:${hookEventName}:${hookPayload.generation_id}`

  let kind: AgentEvent['kind'] = 'activity'
  if (hookEventName === 'SessionStart') kind = 'sessionStart'
  else if (hookEventName === 'SessionEnd') kind = 'sessionEnd'
  else if (hookEventName === 'Stop') kind = 'turnEnd'

  if (raw.notification_type === 'permission_prompt') {
    kind = 'permission'
  }

  return {
    id,
    ts: Date.now(),
    source: 'claude-hook',
    providerId: 'claude-hook',
    agentId: 'claude-code',
    sessionId,
    kind,
    cursorEvent,
    hookPayload,
  }
}
