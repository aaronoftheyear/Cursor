/**
 * Cloud Agent Status Poller
 *
 * Polls Cursor's Cloud Agents API to get status for F.R.I.D.A.Y. and Bumblebee
 * avatars. These agents run as Cursor cloud/background agents, so local hooks
 * never fire for them.
 *
 * The API key must be provided via CURSOR_API_KEY environment variable.
 * When no key is set, the poller degrades gracefully and returns no status.
 */

import type { LiveCursorActivity } from './liveStatus';

const CURSOR_API_BASE = 'https://api.cursor.com/v1';
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const REQUEST_TIMEOUT_MS = 10_000; // 10 seconds

export interface CloudAgentMatch {
  agentId: string;
  payloadContains?: string[];
  agentNameContains?: string[];
}

export interface CloudAgentStatus {
  status: 'idle' | 'working' | 'busy';
  detail?: string;
  activity?: LiveCursorActivity;
  activityDepth?: 'brief' | 'deep';
  source: 'cloud-api';
  cloudAgentId?: string;
  cloudRunStatus?: string;
}

interface CursorAgent {
  id: string;
  name?: string;
  status: 'ACTIVE' | 'ARCHIVED';
  latestRunId?: string;
  createdAt: string;
  updatedAt: string;
}

interface CursorRun {
  id: string;
  agentId: string;
  status: 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED';
  createdAt: string;
  updatedAt: string;
  result?: string;
}

interface ListAgentsResponse {
  items: CursorAgent[];
  nextCursor?: string;
}

interface AgentLinksConfig {
  version: number;
  agents: Record<string, {
    label?: string;
    cursor?: {
      payloadContains?: string[];
      agentNameContains?: string[];
    };
    cloud?: {
      agentNameContains?: string[];
      catchAll?: boolean;
    };
  }>;
}

let cachedStatus: Map<string, CloudAgentStatus> = new Map();
let lastPollTime = 0;
let pollPromise: Promise<void> | null = null;

function getApiKey(): string | null {
  return process.env.CURSOR_API_KEY || null;
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function listCloudAgents(apiKey: string): Promise<CursorAgent[]> {
  const agents: CursorAgent[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${CURSOR_API_BASE}/agents`);
    url.searchParams.set('limit', '50');
    url.searchParams.set('includeArchived', 'false');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.warn('[CloudAgentPoller] Invalid API key or insufficient permissions');
        return [];
      }
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as ListAgentsResponse;
    agents.push(...data.items);
    cursor = data.nextCursor;
  } while (cursor && agents.length < 200);

  return agents;
}

async function getLatestRunStatus(apiKey: string, agentId: string, runId: string): Promise<CursorRun | null> {
  const url = `${CURSOR_API_BASE}/agents/${agentId}/runs/${runId}`;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as CursorRun;
}

export function matchAgentToAvatar(
  agent: CursorAgent,
  config: AgentLinksConfig
): string | null {
  const agentName = (agent.name || '').toLowerCase();
  let catchAllAvatar: string | null = null;

  for (const [avatarId, spec] of Object.entries(config.agents)) {
    if (avatarId === 'jarvis') continue;

    const cloudSpec = spec.cloud || spec.cursor;
    if (!cloudSpec) continue;

    if (spec.cloud?.catchAll) {
      catchAllAvatar = avatarId;
      continue;
    }

    const nameHints = cloudSpec.agentNameContains || [];
    for (const hint of nameHints) {
      if (agentName.includes(hint.toLowerCase())) {
        return avatarId;
      }
    }
  }

  return catchAllAvatar;
}

export function runStatusToAgentStatus(run: CursorRun | null, agent: CursorAgent): CloudAgentStatus {
  const base: CloudAgentStatus = {
    status: 'idle',
    source: 'cloud-api',
    cloudAgentId: agent.id,
  };

  if (!run) {
    return { ...base, detail: 'No active run' };
  }

  base.cloudRunStatus = run.status;

  switch (run.status) {
    case 'CREATING':
      return {
        ...base,
        status: 'working',
        detail: 'Starting cloud agent...',
        activity: 'planning',
        activityDepth: 'brief',
      };
    case 'RUNNING':
      return {
        ...base,
        status: 'working',
        detail: 'Cloud agent running',
        activity: 'thinking',
        activityDepth: 'deep',
      };
    case 'FINISHED':
      return {
        ...base,
        status: 'idle',
        detail: run.result ? `Finished: ${run.result.slice(0, 50)}` : 'Finished',
      };
    case 'ERROR':
      return {
        ...base,
        status: 'idle',
        detail: 'Run errored',
      };
    case 'CANCELLED':
      return {
        ...base,
        status: 'idle',
        detail: 'Run cancelled',
      };
    case 'EXPIRED':
      return {
        ...base,
        status: 'idle',
        detail: 'Run expired',
      };
    default:
      return base;
  }
}

export async function pollCloudAgents(config: AgentLinksConfig): Promise<Map<string, CloudAgentStatus>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return new Map();
  }

  const now = Date.now();
  if (now - lastPollTime < POLL_INTERVAL_MS && cachedStatus.size > 0) {
    return cachedStatus;
  }

  if (pollPromise) {
    await pollPromise;
    return cachedStatus;
  }

  pollPromise = (async () => {
    try {
      const agents = await listCloudAgents(apiKey);
      const newStatus = new Map<string, CloudAgentStatus>();

      for (const agent of agents) {
        const avatarId = matchAgentToAvatar(agent, config);
        if (!avatarId) continue;

        let runStatus: CursorRun | null = null;
        if (agent.latestRunId) {
          runStatus = await getLatestRunStatus(apiKey, agent.id, agent.latestRunId);
        }

        const status = runStatusToAgentStatus(runStatus, agent);

        const existing = newStatus.get(avatarId);
        if (!existing || (status.status === 'working' && existing.status !== 'working')) {
          newStatus.set(avatarId, status);
        }
      }

      cachedStatus = newStatus;
      lastPollTime = now;
    } catch (err) {
      console.warn('[CloudAgentPoller] Poll failed:', err);
    }
  })();

  await pollPromise;
  pollPromise = null;

  return cachedStatus;
}

export function getCloudAgentStatus(): Map<string, CloudAgentStatus> {
  return cachedStatus;
}

export function clearCloudAgentCache(): void {
  cachedStatus.clear();
  lastPollTime = 0;
}
