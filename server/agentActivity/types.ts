/**
 * Normalized agent activity events for the dashboard feed.
 * Inspired by pixel-agents AgentEvent union (MIT) — adapted to this repo's
 * status/activity vocabulary and multi-agent routing.
 */

export type AgentStatusValue = 'idle' | 'working' | 'busy'

export type AgentActivityKind =
  | 'planning'
  | 'thinking'
  | 'reading'
  | 'editing'
  | 'running'
  | 'researching'
  | 'github'
  | 'waiting'

export type AgentEventSource =
  | 'claude-hook'
  | 'claude-session-log'
  | 'cursor-api'
  | 'external-script'
  | 'codex-session-log'

export type AgentEventKind =
  | 'sessionStart'
  | 'sessionEnd'
  | 'turnEnd'
  | 'activity'
  | 'permission'
  | 'idle'

/** Priority: higher wins when two providers emit conflicting state for one session. */
export const SOURCE_PRIORITY: Record<AgentEventSource, number> = {
  'claude-hook': 100,
  'cursor-api': 80,
  'external-script': 70,
  'claude-session-log': 40,
  'codex-session-log': 35,
}

export interface AgentEvent {
  /** Stable id for deduplication within the feed */
  id: string
  ts: number
  source: AgentEventSource
  providerId: string
  agentId: string
  kind: AgentEventKind
  sessionId?: string
  status?: AgentStatusValue
  activity?: AgentActivityKind
  activityDepth?: 'brief' | 'deep'
  detail?: string
  /** Raw hook-style payload for applyViaPython (claude/cursor paths) */
  hookPayload?: Record<string, unknown>
  /** Cursor hook event name when forwarding to Python */
  cursorEvent?: string
}

export interface AgentActivityProvider {
  readonly id: string
  start(emit: (event: AgentEvent) => void): void | Promise<void>
  stop(): void | Promise<void>
}
