import type { AgentEvent } from './types'

export function mapLogEventToCursor(
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
    case 'userPrompt':
      return { name: 'beforeSubmitPrompt', payload: base }
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
