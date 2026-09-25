#!/usr/bin/env node
/**
 * Test the Cursor hook lifecycle handling with multi-turn conversations.
 *
 * Simulates: sessionStart → turn1 (beforeSubmitPrompt...stop) → turn2 (beforeSubmitPrompt...stop) → sessionEnd
 *
 * Run with: node tests/hookLifecycle.test.js
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const STATUS_FILE = path.join(PROJECT_ROOT, '.dashboard', 'live-status.json');
const SEEN_EVENTS_FILE = path.join(PROJECT_ROOT, '.dashboard', 'seen-events.json');
const SCRIPT = path.join(PROJECT_ROOT, '.cursor', 'hooks', 'update-dashboard-status.py');

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

function assertNotEqual(actual, notExpected, msg = '') {
  if (actual === notExpected) {
    throw new Error(`Expected NOT ${JSON.stringify(notExpected)}, but got it. ${msg}`);
  }
}

function cleanState() {
  // Remove status files to start fresh
  try { fs.unlinkSync(STATUS_FILE); } catch {}
  try { fs.unlinkSync(SEEN_EVENTS_FILE); } catch {}
  // Ensure directory exists
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
}

function runHook(event, payload = {}) {
  // Add unique identifiers to prevent dedupe
  const fullPayload = {
    ...payload,
    generation_id: `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    session_id: payload.session_id || 'test-session-1',
    timestamp: Date.now(),
    workspace_roots: [path.join(PROJECT_ROOT)],
  };

  const result = spawnSync('python3', [SCRIPT, event], {
    input: JSON.stringify(fullPayload),
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
  });

  if (result.error) {
    throw result.error;
  }
  return result;
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function getAgentStatus(agentId = 'jarvis') {
  const state = readStatus();
  return state?.agents?.[agentId] || null;
}

function getAgentSessions(agentId = 'jarvis') {
  const state = readStatus();
  return state?.agentSessions?.[agentId] ?? 0;
}

console.log('\n=== Cursor Hook Lifecycle Tests ===\n');
console.log('Testing multi-turn conversation: sessionStart → turn1 → turn2 → sessionEnd\n');

// Clean start
cleanState();

test('Initial state: no status file', () => {
  assertEqual(readStatus(), null);
});

// Session starts
test('sessionStart: agent becomes working', () => {
  runHook('sessionStart', {});
  const status = getAgentStatus();
  assertEqual(status?.status, 'working');
});

test('sessionStart: agentSessions incremented to 1', () => {
  assertEqual(getAgentSessions(), 1);
});

// Turn 1
console.log('\n--- Turn 1 ---\n');

test('beforeSubmitPrompt (turn 1): agent is working', () => {
  runHook('beforeSubmitPrompt', {});
  assertEqual(getAgentStatus()?.status, 'working');
});

test('preToolUse read (turn 1): agent is working/reading', () => {
  runHook('preToolUse', { tool_name: 'read' });
  const status = getAgentStatus();
  assertEqual(status?.status, 'working');
  assertEqual(status?.activity, 'reading');
});

test('afterAgentThought (turn 1): agent is working/thinking', () => {
  runHook('afterAgentThought', {});
  const status = getAgentStatus();
  assertEqual(status?.status, 'working');
  assertEqual(status?.activity, 'thinking');
});

test('stop (turn 1): agent becomes idle', () => {
  runHook('stop', {});
  assertEqual(getAgentStatus()?.status, 'idle');
});

test('stop (turn 1): agentSessions still 1 (stop does NOT decrement)', () => {
  // This is the key fix: stop should NOT decrement agentSessions
  assertEqual(getAgentSessions(), 1);
});

// Turn 2 - this is where the bug would manifest
console.log('\n--- Turn 2 (regression test) ---\n');

test('beforeSubmitPrompt (turn 2): agent becomes working again', () => {
  runHook('beforeSubmitPrompt', {});
  const status = getAgentStatus();
  assertEqual(status?.status, 'working');
});

test('beforeSubmitPrompt (turn 2): agentSessions still 1', () => {
  // Sessions should still be 1, not 0
  assertEqual(getAgentSessions(), 1);
});

test('preToolUse write (turn 2): agent is working/editing', () => {
  runHook('preToolUse', { tool_name: 'write' });
  const status = getAgentStatus();
  assertEqual(status?.status, 'working');
  assertEqual(status?.activity, 'editing');
});

test('postToolUse (turn 2): agent still working', () => {
  runHook('postToolUse', { tool_name: 'write' });
  assertEqual(getAgentStatus()?.status, 'working');
});

test('stop (turn 2): agent becomes idle', () => {
  runHook('stop', {});
  assertEqual(getAgentStatus()?.status, 'idle');
});

// Turn 3 - verify pattern continues
console.log('\n--- Turn 3 ---\n');

test('beforeSubmitPrompt (turn 3): agent becomes working', () => {
  runHook('beforeSubmitPrompt', {});
  assertEqual(getAgentStatus()?.status, 'working');
});

test('preToolUse websearch (turn 3): agent is working/researching', () => {
  runHook('preToolUse', { tool_name: 'websearch' });
  const status = getAgentStatus();
  assertEqual(status?.status, 'working');
  assertEqual(status?.activity, 'researching');
});

test('stop (turn 3): agent becomes idle', () => {
  runHook('stop', {});
  assertEqual(getAgentStatus()?.status, 'idle');
});

// Session ends
console.log('\n--- Session End ---\n');

test('sessionEnd: agent is idle', () => {
  runHook('sessionEnd', {});
  assertEqual(getAgentStatus()?.status, 'idle');
});

test('sessionEnd: agentSessions decremented to 0', () => {
  assertEqual(getAgentSessions(), 0);
});

// Verify self-healing uses time, not session count
console.log('\n--- Self-Healing Verification ---\n');

test('After sessionEnd with sessions=0, new activity still works', () => {
  // Start a new session
  runHook('sessionStart', { session_id: 'test-session-2' });
  assertEqual(getAgentStatus()?.status, 'working');
  assertEqual(getAgentSessions(), 1);
  
  // End turn 1
  runHook('stop', { session_id: 'test-session-2' });
  assertEqual(getAgentStatus()?.status, 'idle');
  
  // Start turn 2 - this is where the old bug would kick in
  runHook('beforeSubmitPrompt', { session_id: 'test-session-2' });
  const status = getAgentStatus();
  // CRITICAL: Agent must be working, not idle
  assertEqual(status?.status, 'working', 'Agent should be working during turn 2, not reset to idle');
});

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  console.log('FAILED: The multi-turn lifecycle is broken.');
  process.exit(1);
} else {
  console.log('SUCCESS: Multi-turn conversations work correctly.');
  process.exit(0);
}
