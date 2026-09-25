#!/usr/bin/env node

const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const tsxBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

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

function runEval(scriptBody) {
  const out = execFileSync(tsxBin, ['--eval', scriptBody], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
  }).trim();
  return JSON.parse(out.split('\n').filter(Boolean).pop());
}

test('thinking activity maps to afterAgentThought (not planning)', () => {
  const out = runEval(`
    import { mapLogEventToCursor } from '${PROJECT_ROOT}/server/agentActivity/logToCursor.ts';
    const mapped = mapLogEventToCursor({
      id: 'x', ts: 1, source: 'claude-session-log', providerId: 'p', agentId: 'claude-code',
      kind: 'activity', activity: 'thinking', sessionId: 's',
    });
    console.log(JSON.stringify({ name: mapped?.name }));
  `);
  if (out.name !== 'afterAgentThought') throw new Error(`expected afterAgentThought, got ${out.name}`);
});

test('turnEnd maps to stop', () => {
  const out = runEval(`
    import { mapLogEventToCursor } from '${PROJECT_ROOT}/server/agentActivity/logToCursor.ts';
    const mapped = mapLogEventToCursor({
      id: 'x', ts: 1, source: 'claude-session-log', providerId: 'p', agentId: 'claude-code',
      kind: 'turnEnd', sessionId: 's',
    });
    console.log(JSON.stringify({ name: mapped?.name }));
  `);
  if (out.name !== 'stop') throw new Error(`expected stop, got ${out.name}`);
});

test('ActivityFeed stop() is a no-op when already stopped', () => {
  const out = runEval(`
    import { ActivityFeed } from '${PROJECT_ROOT}/server/agentActivity/activityFeed.ts';
    let providerStops = 0;
    const feed = new ActivityFeed({
      projectRoot: '${PROJECT_ROOT.replace(/'/g, "\\'")}',
      extraProviders: [{
        id: 'probe',
        start() {},
        stop() { providerStops++; },
      }],
    });
    feed.start();
    feed.stop();
    feed.stop();
    console.log(JSON.stringify({ running: feed.isRunning(), providerStops }));
  `);
  if (out.running !== false) throw new Error('feed should not be running');
  if (out.providerStops !== 1) throw new Error(`provider stop must run once, got ${out.providerStops}`);
});

console.log(`\n=== Log mapping: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
