export type LiveAgentStatusValue = 'idle' | 'working' | 'busy';

/** Cursor hook activity; consumed by engine → action spots. */
export type LiveCursorActivity =
  | 'planning'
  | 'editing'
  | 'running'
  | 'thinking'
  | 'reading'
  | 'researching'
  | 'github'
  | 'waiting';

export const LIVE_ACTIVITY_LABELS: Record<LiveCursorActivity, string> = {
  planning: 'Planning',
  editing: 'Editing',
  running: 'Running',
  thinking: 'Thinking',
  reading: 'Reading',
  researching: 'Researching',
  github: 'GitHub',
  waiting: 'Waiting',
};

/** Brief = stay at computer; deep = walk to planning / research spots. */
export type LiveActivityDepth = 'brief' | 'deep';

export interface LiveAgentStatus {
  status: LiveAgentStatusValue;
  source?: string;
  detail?: string;
  activity?: LiveCursorActivity;
  activityDepth?: LiveActivityDepth;
}

export interface LiveStatusSnapshot {
  updatedAt?: string;
  activeSessions?: number;
  /** In-flight / open Cursor integrated terminal sessions (from shell hooks). */
  activeTerminals?: number;
  agents: Record<string, LiveAgentStatus>;
}

export interface AgentLinksConfig {
  version: number;
  agents: Record<
    string,
    {
      label?: string;
      cursor?: {
        /** Match when hook payload JSON contains any of these (case-insensitive). */
        payloadContains?: string[];
        /** Match when workspace_roots path contains any fragment. */
        workspaceContains?: string[];
        /** Match subagent / cloud agent name fields. */
        agentNameContains?: string[];
      };
      cloud?: {
        /** Match subagent / cloud agent name fields. */
        agentNameContains?: string[];
        /** True if this avatar is a catch-all for unmatched cloud agents. */
        catchAll?: boolean;
      };
    }
  >;
}

export const EMPTY_LIVE_STATUS: LiveStatusSnapshot = {
  updatedAt: undefined,
  activeSessions: 0,
  agents: {},
};
