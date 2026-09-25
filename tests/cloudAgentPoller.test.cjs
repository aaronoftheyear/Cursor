#!/usr/bin/env node
/**
 * Unit tests for cloud agent mapping logic
 *
 * Run with: node tests/cloudAgentPoller.test.js
 */

function matchAgentToAvatar(agent, config) {
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

function runStatusToAgentStatus(run) {
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

const testConfig = {
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

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}. ${msg}`);
  }
}

function assertIncludes(str, substr) {
  if (!str.includes(substr)) {
    throw new Error(`Expected "${str}" to include "${substr}"`);
  }
}

console.log('\n=== matchAgentToAvatar tests ===\n');

test('matches friday by name', () => {
  const agent = { id: 'bc-123', name: 'F.R.I.D.A.Y. troubleshooting', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfig), 'friday');
});

test('matches friday by cloud coordinator hint', () => {
  const agent = { id: 'bc-123', name: 'Cloud Coordinator v2', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfig), 'friday');
});

test('matches bumblebee by name', () => {
  const agent = { id: 'bc-456', name: 'Bumblebee Protocol Runner', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfig), 'bumblebee');
});

test('matches bumblebee by cloud worker hint', () => {
  const agent = { id: 'bc-456', name: 'cloud worker instance', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfig), 'bumblebee');
});

test('matches bumblebee by background agent hint', () => {
  const agent = { id: 'bc-456', name: 'Background Agent Task', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfig), 'bumblebee');
});

test('does not match jarvis (local only)', () => {
  const agent = { id: 'bc-789', name: 'JARVIS assistant', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfig), null);
});

test('returns null for unmatched agents', () => {
  const agent = { id: 'bc-000', name: 'Random Task Agent', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfig), null);
});

test('handles missing name', () => {
  const agent = { id: 'bc-000', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfig), null);
});

console.log('\n=== runStatusToAgentStatus tests ===\n');

test('handles CREATING run', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'CREATING' };
  const status = runStatusToAgentStatus(run);
  assertEqual(status.status, 'working');
  assertEqual(status.activity, 'planning');
});

test('handles RUNNING run', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'RUNNING' };
  const status = runStatusToAgentStatus(run);
  assertEqual(status.status, 'working');
  assertEqual(status.activity, 'thinking');
});

test('handles FINISHED run with result', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'FINISHED', result: 'Added README.md' };
  const status = runStatusToAgentStatus(run);
  assertEqual(status.status, 'idle');
  assertIncludes(status.detail, 'Finished');
  assertIncludes(status.detail, 'Added README.md');
});

test('handles FINISHED run without result', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'FINISHED' };
  const status = runStatusToAgentStatus(run);
  assertEqual(status.status, 'idle');
  assertEqual(status.detail, 'Finished');
});

test('handles ERROR run', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'ERROR' };
  const status = runStatusToAgentStatus(run);
  assertEqual(status.status, 'idle');
  assertEqual(status.detail, 'Run errored');
});

test('handles CANCELLED run', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'CANCELLED' };
  const status = runStatusToAgentStatus(run);
  assertEqual(status.status, 'idle');
  assertEqual(status.detail, 'Run cancelled');
});

test('handles null run', () => {
  const status = runStatusToAgentStatus(null);
  assertEqual(status.status, 'idle');
  assertEqual(status.detail, 'No active run');
});

console.log('\n=== Integration scenario ===\n');

test('full workflow: cloud agent starts, runs, finishes', () => {
  const agent = { id: 'bc-123', name: 'Bumblebee Protocol', status: 'ACTIVE', latestRunId: 'run-1' };
  assertEqual(matchAgentToAvatar(agent, testConfig), 'bumblebee');

  const creatingRun = { id: 'run-1', agentId: 'bc-123', status: 'CREATING' };
  assertEqual(runStatusToAgentStatus(creatingRun).status, 'working');

  const runningRun = { id: 'run-1', agentId: 'bc-123', status: 'RUNNING' };
  assertEqual(runStatusToAgentStatus(runningRun).status, 'working');

  const finishedRun = { id: 'run-1', agentId: 'bc-123', status: 'FINISHED', result: 'Done!' };
  assertEqual(runStatusToAgentStatus(finishedRun).status, 'idle');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
