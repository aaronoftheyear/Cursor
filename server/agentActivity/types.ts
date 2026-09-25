/**
 * Normalized agent activity events for the dashboard feed.
 * Inspired by pixel-agents AgentEvent union (MIT).
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

export type AgentEventSource = 'claude-hook' | 'claude-session-log'

export type AgentEventKind =
  | 'sessionStart'
  | 'sessionEnd'
  | 'turnEnd'
  | 'userPrompt'
  | 'activity'
  | 'permission'
  | 'idle'

export interface AgentEvent {
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
  hookPayload?: Record<string, unknown>
  cursorEvent?: string
}

export interface AgentActivityProvider {
  readonly id: string
  start(emit: (event: AgentEvent) => void): void | Promise<void>
  stop(): void | Promise<void>
}
