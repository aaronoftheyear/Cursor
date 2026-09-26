#!/usr/bin/env node
/**
 * Unit tests for cloud agent mapping logic
 *
 * Imports the real matchAgentToAvatar function from src/cloudAgentPoller.ts
 * using tsx. Fails hard if the import fails.
 *
 * Run with: node tests/cloudAgentPoller.test.cjs
 */

const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');

console.log('\n=== Cloud Agent Poller Tests ===\n');

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

// Import the real matchAgentToAvatar function using tsx
let matchAgentToAvatar;
try {
  const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
  const modulePath = path.resolve(__dirname, '../src/cloudAgentPoller.ts');
  
  const code = `
    const m = require('${modulePath.replace(/\\/g, '\\\\')}');
    const testAgent = { id: 'test', name: 'friday test', status: 'ACTIVE' };
    const testConfig = {
      version: 2,
      agents: {
        friday: { cloud: { agentNameContains: ['friday'] } },
        'cursor-cloud': { cloud: { catchAll: true } }
      }
    };
    console.log(JSON.stringify({
      hasFunction: typeof m.matchAgentToAvatar === 'function',
      testResult: m.matchAgentToAvatar(testAgent, testConfig)
    }));
  `;
  
  const result = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    encoding: 'utf-8',
    cwd: path.resolve(__dirname, '..'),
  });
  
  const parsed = JSON.parse(result.trim());
  if (!parsed.hasFunction) {
    throw new Error('matchAgentToAvatar is not exported from cloudAgentPoller.ts');
  }
  if (parsed.testResult !== 'friday') {
    throw new Error(`Self-test failed: expected 'friday', got '${parsed.testResult}'`);
  }
  
  // Create a wrapper that calls tsx for each test
  matchAgentToAvatar = (agent, config) => {
    const agentJson = JSON.stringify(agent).replace(/"/g, '\\"');
    const configJson = JSON.stringify(config).replace(/"/g, '\\"');
    const code = `
      const m = require('${modulePath.replace(/\\/g, '\\\\')}');
      console.log(JSON.stringify(m.matchAgentToAvatar(${JSON.stringify(agent)}, ${JSON.stringify(config)})));
    `;
    const res = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });
    return JSON.parse(res.trim());
  };
  
  console.log('✓ Successfully imported real matchAgentToAvatar from cloudAgentPoller.ts\n');
} catch (e) {
  console.error('FATAL: Failed to import src/cloudAgentPoller.ts');
  console.error('Make sure tsx is installed: npm install --save-dev tsx');
  console.error('Error:', e.message);
  process.exit(1);
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
    'cursor-cloud': {
      label: 'Cursor Cloud (catch-all)',
      cloud: { catchAll: true },
    },
  },
};

console.log('--- matchAgentToAvatar tests ---\n');

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
  assertEqual(matchAgentToAvatar(agent, testConfig), 'cursor-cloud');
});

test('returns null for unmatched agents', () => {
  const agent = { id: 'bc-000', name: 'Random Task Agent', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfig), 'cursor-cloud');
});

test('handles missing name', () => {
  const agent = { id: 'bc-000', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfig), 'cursor-cloud');
});

const testConfigNoCatchAll = {
  version: 2,
  agents: {
    friday: {
      label: 'F.R.I.D.A.Y.',
      cloud: { agentNameContains: ['friday'] },
    },
  },
};

test('returns null when no catch-all configured', () => {
  const agent = { id: 'bc-000', name: 'Random Agent', status: 'ACTIVE' };
  assertEqual(matchAgentToAvatar(agent, testConfigNoCatchAll), null);
});

console.log('\n--- runStatusToAgentStatus tests (real function) ---\n');

// Import the real runStatusToAgentStatus function using tsx
let runStatusToAgentStatus;
try {
  const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
  const modulePath = path.resolve(__dirname, '../src/cloudAgentPoller.ts');
  
  // Create a wrapper that calls the real function
  runStatusToAgentStatus = (run, agent = { id: 'test-agent' }) => {
    const code = `
      const m = require('${modulePath.replace(/\\/g, '\\\\')}');
      const run = ${JSON.stringify(run)};
      const agent = ${JSON.stringify(agent)};
      console.log(JSON.stringify(m.runStatusToAgentStatus(run, agent)));
    `;
    const res = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });
    return JSON.parse(res.trim());
  };
  
  // Verify the function exists
  const verifyCode = `
    const m = require('${modulePath.replace(/\\/g, '\\\\')}');
    console.log(typeof m.runStatusToAgentStatus === 'function');
  `;
  const verifyResult = execSync(`"${tsxPath}" -e "${verifyCode.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    encoding: 'utf-8',
    cwd: path.resolve(__dirname, '..'),
  });
  if (verifyResult.trim() !== 'true') {
    throw new Error('runStatusToAgentStatus is not exported');
  }
  
  console.log('✓ Successfully imported real runStatusToAgentStatus from cloudAgentPoller.ts\n');
} catch (e) {
  console.error('FATAL: Failed to import runStatusToAgentStatus from cloudAgentPoller.ts');
  console.error('Error:', e.message);
  process.exit(1);
}

const testAgent = { id: 'bc-123', name: 'Test Agent', status: 'ACTIVE' };

test('handles CREATING run', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'CREATING' };
  const status = runStatusToAgentStatus(run, testAgent);
  assertEqual(status.status, 'working');
  assertEqual(status.activity, 'planning');
  assertEqual(status.cloudAgentId, 'bc-123');
});

test('handles RUNNING run', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'RUNNING' };
  const status = runStatusToAgentStatus(run, testAgent);
  assertEqual(status.status, 'working');
  assertEqual(status.activity, 'thinking');
});

test('handles FINISHED run with result', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'FINISHED', result: 'Added README.md' };
  const status = runStatusToAgentStatus(run, testAgent);
  assertEqual(status.status, 'idle');
  assertIncludes(status.detail, 'Finished');
  assertIncludes(status.detail, 'Added README.md');
});

test('handles FINISHED run without result', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'FINISHED' };
  const status = runStatusToAgentStatus(run, testAgent);
  assertEqual(status.status, 'idle');
  assertEqual(status.detail, 'Finished');
});

test('handles ERROR run', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'ERROR' };
  const status = runStatusToAgentStatus(run, testAgent);
  assertEqual(status.status, 'idle');
  assertEqual(status.detail, 'Run errored');
});

test('handles CANCELLED run', () => {
  const run = { id: 'run-1', agentId: 'bc-123', status: 'CANCELLED' };
  const status = runStatusToAgentStatus(run, testAgent);
  assertEqual(status.status, 'idle');
  assertEqual(status.detail, 'Run cancelled');
});

test('handles null run', () => {
  const status = runStatusToAgentStatus(null, testAgent);
  assertEqual(status.status, 'idle');
  assertEqual(status.detail, 'No active run');
});

console.log('\n--- Integration scenario ---\n');

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

console.log('\n--- mapCloudAgentPollItems (vite poll mapping) ---\n');

let mapCloudAgentPollItems;
let buildPolledCloudAgentStatus;
try {
  const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
  const viteConfigPath = path.resolve(__dirname, '../vite.config.ts');

  const verifyCode = `
    import { mapCloudAgentPollItems, buildPolledCloudAgentStatus } from '${viteConfigPath.replace(/\\/g, '/')}';
    console.log(JSON.stringify({
      hasMap: typeof mapCloudAgentPollItems === 'function',
      hasBuild: typeof buildPolledCloudAgentStatus === 'function',
    }));
  `;
  const verifyResult = execSync(`"${tsxPath}" -e "${verifyCode.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    encoding: 'utf-8',
    cwd: path.resolve(__dirname, '..'),
  });
  const verifyParsed = JSON.parse(verifyResult.trim());
  if (!verifyParsed.hasMap || !verifyParsed.hasBuild) {
    throw new Error('vite poll mapping exports missing');
  }

  mapCloudAgentPollItems = (items, config) => {
    const code = `
      import { mapCloudAgentPollItems } from '${viteConfigPath.replace(/\\/g, '/')}';
      const items = ${JSON.stringify(items)};
      const config = ${JSON.stringify(config)};
      const { avatarCache, idCache } = mapCloudAgentPollItems(items, config);
      console.log(JSON.stringify({
        avatar: Object.fromEntries(avatarCache),
        byId: Object.fromEntries(idCache),
      }));
    `;
    const res = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });
    const parsed = JSON.parse(res.trim());
    return { avatarCache: parsed.avatar, idCache: parsed.byId };
  };

  buildPolledCloudAgentStatus = (agent, runStatus, detail) => {
    const code = `
      import { buildPolledCloudAgentStatus } from '${viteConfigPath.replace(/\\/g, '/')}';
      console.log(JSON.stringify(buildPolledCloudAgentStatus(
        ${JSON.stringify(agent)},
        ${JSON.stringify(runStatus)},
        ${JSON.stringify(detail)}
      )));
    `;
    const res = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });
    return JSON.parse(res.trim());
  };

  console.log('✓ Successfully imported vite poll mapping helpers\n');
} catch (e) {
  console.error('FATAL: Failed to import poll mapping from vite.config.ts');
  console.error('Error:', e.message);
  process.exit(1);
}

test('buildPolledCloudAgentStatus sets cloudAgentName (no ReferenceError)', () => {
  const status = buildPolledCloudAgentStatus(
    { id: 'bc-friday', name: 'F.R.I.D.A.Y. cloud run' },
    'idle',
    'Cloud agent idle'
  );
  assertEqual(status.cloudAgentName, 'F.R.I.D.A.Y. cloud run');
  assertEqual(status.cloudAgentId, 'bc-friday');
});

test('poll mapping: named F.R.I.D.A.Y. maps to friday avatar', () => {
  const items = [
    { id: 'bc-friday', name: 'F.R.I.D.A.Y. troubleshooting' },
  ];
  const { avatarCache, idCache } = mapCloudAgentPollItems(items, testConfig);
  assertEqual(avatarCache.friday?.cloudAgentName, 'F.R.I.D.A.Y. troubleshooting');
  assertEqual(idCache['bc-friday']?.cloudAgentName, 'F.R.I.D.A.Y. troubleshooting');
});

test('poll mapping: unmatched agent uses cursor-cloud catch-all avatar', () => {
  const items = [
    { id: 'bc-unknown', name: 'Random one-off cloud task' },
  ];
  const { avatarCache, idCache } = mapCloudAgentPollItems(items, testConfig);
  assertEqual(avatarCache['cursor-cloud']?.cloudAgentName, 'Random one-off cloud task');
  assertEqual(idCache['bc-unknown']?.cloudAgentId, 'bc-unknown');
});

test('poll mapping: Bumblebee name maps to bumblebee avatar', () => {
  const items = [{ id: 'bc-bee', name: 'Bumblebee Protocol Runner' }];
  const { avatarCache } = mapCloudAgentPollItems(items, testConfig);
  assertEqual(avatarCache.bumblebee?.cloudAgentName, 'Bumblebee Protocol Runner');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
