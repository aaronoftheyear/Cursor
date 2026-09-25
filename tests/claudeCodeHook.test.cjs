#!/usr/bin/env node
/**
 * Test Claude Code hook integration and TTL/waiting-on features.
 *
 * Run with: node tests/claudeCodeHook.test.cjs
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const STATUS_FILE = path.join(PROJECT_ROOT, '.dashboard', 'live-status.json');
const EXTERNAL_FILE = path.join(PROJECT_ROOT, '.dashboard', 'external-agents.json');
const SEEN_EVENTS_FILE = path.join(PROJECT_ROOT, '.dashboard', 'seen-events.json');
const HOOK_SCRIPT = path.join(PROJECT_ROOT, '.cursor', 'hooks', 'claude-code-hook.cjs');
const STATUS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'set-agent-status.sh');
const UPDATE_SCRIPT = path.join(PROJECT_ROOT, '.cursor', 'hooks', 'update-dashboard-status.py');

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

function assertTrue(value, msg = '') {
  if (!value) {
    throw new Error(`Expected truthy value, got ${JSON.stringify(value)}. ${msg}`);
  }
}

function cleanState() {
  try { fs.unlinkSync(STATUS_FILE); } catch {}
  try { fs.unlinkSync(EXTERNAL_FILE); } catch {}
  try { fs.unlinkSync(SEEN_EVENTS_FILE); } catch {}
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function readExternalAgents() {
  try {
    return JSON.parse(fs.readFileSync(EXTERNAL_FILE, 'utf-8'));
  } catch {
    return { agents: {} };
  }
}

function runPythonHook(event, payload = {}) {
  const fullPayload = {
    ...payload,
    generation_id: `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    session_id: payload.session_id || 'test-claude-session',
    timestamp: Date.now(),
    workspace_roots: [PROJECT_ROOT],
    source: 'claude-code',
    claude_code: true,
    agent_name: 'claude-code',
  };

  const result = spawnSync('python3', [UPDATE_SCRIPT, event], {
    input: JSON.stringify(fullPayload),
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
  });

  if (result.error) throw result.error;
  return result;
}

function runStatusScript(agentId, status, options = []) {
  const args = [agentId, status, ...options];
  const result = spawnSync('bash', [STATUS_SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
  });
  return result;
}

console.log('\n=== Claude Code Hook Tests ===\n');

cleanState();

// Test Claude Code hook script syntax
console.log('--- Hook Script Validation ---\n');

test('claude-code-hook.js exists and is valid JS', () => {
  assertTrue(fs.existsSync(HOOK_SCRIPT), 'Hook script should exist');
  const hookCode = fs.readFileSync(HOOK_SCRIPT, 'utf-8');
  // Strip shebang for syntax check
  const codeWithoutShebang = hookCode.replace(/^#!.*\n/, '');
  // This will throw if syntax is invalid
  new Function(codeWithoutShebang);
});

test('claude-code-hook.js has correct event mappings', () => {
  const hookCode = fs.readFileSync(HOOK_SCRIPT, 'utf-8');
  assertTrue(hookCode.includes('SessionStart'), 'Should handle SessionStart');
  assertTrue(hookCode.includes('PreToolUse'), 'Should handle PreToolUse');
  assertTrue(hookCode.includes('PostToolUse'), 'Should handle PostToolUse');
  assertTrue(hookCode.includes('Stop'), 'Should handle Stop');
  assertTrue(hookCode.includes('SessionEnd'), 'Should handle SessionEnd');
});

// Test Claude Code events via update-dashboard-status.py
console.log('\n--- Claude Code Status Updates ---\n');

test('sessionStart: claude-code agent becomes working', () => {
  cleanState();
  runPythonHook('sessionStart', {});
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.status, 'working');
  assertEqual(status?.agents?.['claude-code']?.source, 'claude-code');
});

test('preToolUse Read: claude-code is reading', () => {
  runPythonHook('preToolUse', { tool_name: 'read' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'reading');
});

test('preToolUse Edit: claude-code is editing', () => {
  runPythonHook('preToolUse', { tool_name: 'edit' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'editing');
});

test('preToolUse Bash: claude-code is running', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'npm test' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'running');
});

test('preToolUse gh command: claude-code is github', () => {
  runPythonHook('preToolUse', { tool_name: 'shell', command: 'gh pr create' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'github');
});

test('preToolUse TodoWrite: claude-code is planning', () => {
  runPythonHook('preToolUse', { tool_name: 'todo_write' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'planning');
});

test('preToolUse WebSearch: claude-code is researching', () => {
  runPythonHook('preToolUse', { tool_name: 'websearch' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'researching');
});

test('stop: claude-code goes idle', () => {
  runPythonHook('stop', {});
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.status, 'idle');
});

// Test TTL feature in set-agent-status.sh
console.log('\n--- TTL Feature Tests ---\n');

test('set-agent-status.sh: TTL in seconds', () => {
  const result = runStatusScript('metabee', 'working', ['-a', 'reading', '-t', '300']);
  assertEqual(result.status, 0, 'Script should exit successfully');
  const data = readExternalAgents();
  assertEqual(data.agents.metabee?.ttlSeconds, 300);
  assertTrue(data.agents.metabee?.expiresAt, 'Should have expiresAt');
});

test('set-agent-status.sh: TTL in minutes (5m)', () => {
  runStatusScript('metabee', 'working', ['-a', 'thinking', '-t', '5m']);
  const data = readExternalAgents();
  assertEqual(data.agents.metabee?.ttlSeconds, 300);
});

test('set-agent-status.sh: TTL in hours (1h)', () => {
  runStatusScript('metabee', 'working', ['-a', 'planning', '-t', '1h']);
  const data = readExternalAgents();
  assertEqual(data.agents.metabee?.ttlSeconds, 3600);
});

test('set-agent-status.sh: TTL compound format (1h30m)', () => {
  runStatusScript('metabee', 'working', ['-a', 'reading', '-t', '1h30m']);
  const data = readExternalAgents();
  assertEqual(data.agents.metabee?.ttlSeconds, 5400);
});

test('set-agent-status.sh: TTL max limit (2h)', () => {
  const result = runStatusScript('metabee', 'working', ['-a', 'reading', '-t', '3h']);
  assertNotEqual(result.status, 0, 'Should fail for TTL > 2h');
});

test('set-agent-status.sh: default TTL is 120 seconds', () => {
  runStatusScript('grokbot', 'working', ['-a', 'thinking']);
  const data = readExternalAgents();
  assertEqual(data.agents.grokbot?.ttlSeconds, 120);
});

// Test waiting-on feature
console.log('\n--- Waiting-on Feature Tests ---\n');

test('set-agent-status.sh: --waiting-on sets waitingOn field', () => {
  runStatusScript('metabee', 'working', ['-a', 'waiting', '--waiting-on', 'bc-abc123', '-t', '1h']);
  const data = readExternalAgents();
  assertEqual(data.agents.metabee?.waitingOn, 'bc-abc123');
  assertEqual(data.agents.metabee?.activity, 'waiting');
});

test('set-agent-status.sh: --waiting-on implies activity=waiting', () => {
  runStatusScript('metabee', 'working', ['--waiting-on', 'bc-xyz789']);
  const data = readExternalAgents();
  assertEqual(data.agents.metabee?.activity, 'waiting');
  assertEqual(data.agents.metabee?.waitingOn, 'bc-xyz789');
});

test('set-agent-status.sh: --waiting-on implies status=working even if idle specified', () => {
  runStatusScript('metabee', 'idle', ['--waiting-on', 'FRIDAY agent']);
  const data = readExternalAgents();
  assertEqual(data.agents.metabee?.status, 'working');
  assertEqual(data.agents.metabee?.activity, 'waiting');
  assertEqual(data.agents.metabee?.waitingOn, 'FRIDAY agent');
});

test('set-agent-status.sh: --waiting-on with name instead of bc-id', () => {
  runStatusScript('metabee', 'working', ['--waiting-on', 'Connect Claude Code', '-t', '1h', '-m', 'Waiting on cloud agent']);
  const data = readExternalAgents();
  assertEqual(data.agents.metabee?.waitingOn, 'Connect Claude Code');
  assertTrue(data.agents.metabee?.detail?.includes('Waiting on cloud agent'));
});

// Test backward compatibility
console.log('\n--- Backward Compatibility Tests ---\n');

test('set-agent-status.sh: works without TTL (uses default)', () => {
  runStatusScript('grokbot', 'working', ['-a', 'github', '-m', 'Pushing']);
  const data = readExternalAgents();
  assertEqual(data.agents.grokbot?.status, 'working');
  assertEqual(data.agents.grokbot?.activity, 'github');
  assertEqual(data.agents.grokbot?.ttlSeconds, 120);
});

test('set-agent-status.sh: idle status still works', () => {
  runStatusScript('grokbot', 'idle');
  const data = readExternalAgents();
  assertEqual(data.agents.grokbot?.status, 'idle');
});

test('set-agent-status.sh: all activity types still valid', () => {
  const activities = ['planning', 'thinking', 'reading', 'editing', 'running', 'researching', 'github', 'waiting'];
  for (const activity of activities) {
    const result = runStatusScript('testbot', 'working', ['-a', activity]);
    assertEqual(result.status, 0, `Activity ${activity} should be valid`);
  }
});

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
