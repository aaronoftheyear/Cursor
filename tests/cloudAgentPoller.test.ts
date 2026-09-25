/**
 * Unit tests for cloud agent mapping logic
 *
 * Run with: npx vitest run tests/cloudAgentPoller.test.ts
 */

import { describe, it, expect } from 'vitest';

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
    };
  }>;
}

interface CursorAgent {
  id: string;
  name?: string;
  status: 'ACTIVE' | 'ARCHIVED';
  latestRunId?: string;
}

interface CursorRun {
  id: string;
  agentId: string;
  status: 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED';
  result?: string;
}

function matchAgentToAvatar(
  agent: CursorAgent,
  config: AgentLinksConfig
): string | null {
  const agentName = (agent.name || '').toLowerCase();

  for (const [avatarId, spec] of Object.entries(config.agents)) {
    if (avatarId === 'jarvis') continue;

    const cloudSpec = spec.cloud || spec.cursor;
    if (!cloudSpec) continue;

    const nameHints = cloudSpec.agentNameContains || [];
    for (const hint of nameHints) {
      if (agentName.includes(hint.toLowerCase())) {
        return avatarId;
      }
    }
  }

  return null;
}

function runStatusToAgentStatus(run: CursorRun | null) {
  if (!run) {
    return { status: 'idle', detail: 'No active run' };
  }

  switch (run.status) {
    case 'CREATING':
      return { status: 'working', detail: 'Starting cloud agent...', activity: 'planning' };
    case 'RUNNING':
      return { status: 'working', detail: 'Cloud agent running', activity: 'thinking' };
    case 'FINISHED':
      return { status: 'idle', detail: run.result ? `Finished: ${run.result.slice(0, 50)}` : 'Finished' };
    case 'ERROR':
      return { status: 'idle', detail: 'Run errored' };
    case 'CANCELLED':
      return { status: 'idle', detail: 'Run cancelled' };
    case 'EXPIRED':
      return { status: 'idle', detail: 'Run expired' };
    default:
      return { status: 'idle', detail: 'Unknown status' };
  }
}

const testConfig: AgentLinksConfig = {
  version: 2,
  agents: {
    jarvis: {
      label: 'J.A.R.V.I.S.',
      cursor: { agentNameContains: ['jarvis'] },
    },
    friday: {
      label: 'F.R.I.D.A.Y.',
      cursor: { agentNameContains: ['friday', 'f.r.i.d.a.y'] },
      cloud: { agentNameContains: ['friday', 'f.r.i.d.a.y', 'cloud coordinator', 'troubleshoot'] },
    },
    bumblebee: {
      label: 'Bumblebee',
      cursor: { agentNameContains: ['bumblebee', 'cloud-worker'] },
      cloud: { agentNameContains: ['bumblebee', 'cloud-worker', 'cloud worker', 'background agent'] },
    },
  },
};

describe('matchAgentToAvatar', () => {
  it('matches friday by name', () => {
    const agent: CursorAgent = { id: 'bc-123', name: 'F.R.I.D.A.Y. troubleshooting', status: 'ACTIVE' };
    expect(matchAgentToAvatar(agent, testConfig)).toBe('friday');
  });

  it('matches friday by cloud coordinator hint', () => {
    const agent: CursorAgent = { id: 'bc-123', name: 'Cloud Coordinator v2', status: 'ACTIVE' };
    expect(matchAgentToAvatar(agent, testConfig)).toBe('friday');
  });

  it('matches bumblebee by name', () => {
    const agent: CursorAgent = { id: 'bc-456', name: 'Bumblebee Protocol Runner', status: 'ACTIVE' };
    expect(matchAgentToAvatar(agent, testConfig)).toBe('bumblebee');
  });

  it('matches bumblebee by cloud worker hint', () => {
    const agent: CursorAgent = { id: 'bc-456', name: 'cloud worker instance', status: 'ACTIVE' };
    expect(matchAgentToAvatar(agent, testConfig)).toBe('bumblebee');
  });

  it('matches bumblebee by background agent hint', () => {
    const agent: CursorAgent = { id: 'bc-456', name: 'Background Agent Task', status: 'ACTIVE' };
    expect(matchAgentToAvatar(agent, testConfig)).toBe('bumblebee');
  });

  it('does not match jarvis (local only)', () => {
    const agent: CursorAgent = { id: 'bc-789', name: 'JARVIS assistant', status: 'ACTIVE' };
    expect(matchAgentToAvatar(agent, testConfig)).toBe(null);
  });

  it('returns null for unmatched agents', () => {
    const agent: CursorAgent = { id: 'bc-000', name: 'Random Task Agent', status: 'ACTIVE' };
    expect(matchAgentToAvatar(agent, testConfig)).toBe(null);
  });

  it('handles missing name', () => {
    const agent: CursorAgent = { id: 'bc-000', status: 'ACTIVE' };
    expect(matchAgentToAvatar(agent, testConfig)).toBe(null);
  });
});

describe('runStatusToAgentStatus', () => {
  it('handles CREATING run', () => {
    const run: CursorRun = { id: 'run-1', agentId: 'bc-123', status: 'CREATING' };
    const status = runStatusToAgentStatus(run);
    expect(status.status).toBe('working');
    expect(status.activity).toBe('planning');
  });

  it('handles RUNNING run', () => {
    const run: CursorRun = { id: 'run-1', agentId: 'bc-123', status: 'RUNNING' };
    const status = runStatusToAgentStatus(run);
    expect(status.status).toBe('working');
    expect(status.activity).toBe('thinking');
  });

  it('handles FINISHED run with result', () => {
    const run: CursorRun = { id: 'run-1', agentId: 'bc-123', status: 'FINISHED', result: 'Added README.md' };
    const status = runStatusToAgentStatus(run);
    expect(status.status).toBe('idle');
    expect(status.detail).toContain('Finished');
    expect(status.detail).toContain('Added README.md');
  });

  it('handles FINISHED run without result', () => {
    const run: CursorRun = { id: 'run-1', agentId: 'bc-123', status: 'FINISHED' };
    const status = runStatusToAgentStatus(run);
    expect(status.status).toBe('idle');
    expect(status.detail).toBe('Finished');
  });

  it('handles ERROR run', () => {
    const run: CursorRun = { id: 'run-1', agentId: 'bc-123', status: 'ERROR' };
    const status = runStatusToAgentStatus(run);
    expect(status.status).toBe('idle');
    expect(status.detail).toBe('Run errored');
  });

  it('handles CANCELLED run', () => {
    const run: CursorRun = { id: 'run-1', agentId: 'bc-123', status: 'CANCELLED' };
    const status = runStatusToAgentStatus(run);
    expect(status.status).toBe('idle');
    expect(status.detail).toBe('Run cancelled');
  });

  it('handles null run', () => {
    const status = runStatusToAgentStatus(null);
    expect(status.status).toBe('idle');
    expect(status.detail).toBe('No active run');
  });
});

describe('integration scenarios', () => {
  it('full workflow: cloud agent starts, runs, finishes', () => {
    const agent: CursorAgent = { id: 'bc-123', name: 'Bumblebee Protocol', status: 'ACTIVE', latestRunId: 'run-1' };
    const avatarId = matchAgentToAvatar(agent, testConfig);
    expect(avatarId).toBe('bumblebee');

    const creatingRun: CursorRun = { id: 'run-1', agentId: 'bc-123', status: 'CREATING' };
    expect(runStatusToAgentStatus(creatingRun).status).toBe('working');

    const runningRun: CursorRun = { id: 'run-1', agentId: 'bc-123', status: 'RUNNING' };
    expect(runStatusToAgentStatus(runningRun).status).toBe('working');

    const finishedRun: CursorRun = { id: 'run-1', agentId: 'bc-123', status: 'FINISHED', result: 'Done!' };
    expect(runStatusToAgentStatus(finishedRun).status).toBe('idle');
  });
});
