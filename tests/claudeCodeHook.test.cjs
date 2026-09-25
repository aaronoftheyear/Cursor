#!/usr/bin/env node
/**
 * Test Claude Code hook integration and TTL/waiting-on features.
 *
 * - Hook script validation tests use code inspection
 * - TTL/waiting-on tests use temp directories  
 * - Python hook tests run against the real project directory (same as hookLifecycle tests)
 *
 * Run with: node tests/claudeCodeHook.test.cjs
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOOK_SCRIPT = path.join(PROJECT_ROOT, '.cursor', 'hooks', 'claude-code-hook.cjs');
const UPDATE_SCRIPT = path.join(PROJECT_ROOT, '.cursor', 'hooks', 'update-dashboard-status.py');
const STATUS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'set-agent-status.sh');
const STATUS_FILE = path.join(PROJECT_ROOT, '.dashboard', 'live-status.json');
const EXTERNAL_FILE = path.join(PROJECT_ROOT, '.dashboard', 'external-agents.json');
const SEEN_EVENTS_FILE = path.join(PROJECT_ROOT, '.dashboard', 'seen-events.json');

let passed = 0;
let failed = 0;
let tempDir = null;

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

// Setup temp directory for external agent tests only
function setupTempDir() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-'));
  fs.mkdirSync(path.join(tempDir, '.dashboard'), { recursive: true });
  return tempDir;
}

function cleanupTempDir() {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function cleanProjectState() {
  // Clean project state for Python hook tests
  try { fs.unlinkSync(STATUS_FILE); } catch {}
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

function readTempExternalAgents() {
  const externalFile = path.join(tempDir, '.dashboard', 'external-agents.json');
  try {
    return JSON.parse(fs.readFileSync(externalFile, 'utf-8'));
  } catch {
    return { agents: {} };
  }
}

// Run the Python hook script with Claude-style payload
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

// Run status script with temp directory
function runStatusScript(agentId, status, options = []) {
  const externalFile = path.join(tempDir, '.dashboard', 'external-agents.json');
  
  // Create modified script that uses temp file
  const scriptContent = fs.readFileSync(STATUS_SCRIPT, 'utf-8');
  const modifiedScript = scriptContent.replace(
    /STATUS_FILE="\$PROJECT_ROOT\/\.dashboard\/external-agents\.json"/,
    `STATUS_FILE="${externalFile}"`
  );
  
  const tempScript = path.join(tempDir, 'set-agent-status.sh');
  fs.writeFileSync(tempScript, modifiedScript);
  fs.chmodSync(tempScript, '755');
  
  const args = [agentId, status, ...options];
  const result = spawnSync('bash', [tempScript, ...args], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
  });
  
  return result;
}

console.log('\n=== Claude Code Hook Tests ===\n');

// Test Hook Script Validation
console.log('--- Hook Script Validation ---\n');

test('claude-code-hook.cjs exists and is valid JS', () => {
  assertTrue(fs.existsSync(HOOK_SCRIPT), 'Hook script should exist');
  const hookCode = fs.readFileSync(HOOK_SCRIPT, 'utf-8');
  const codeWithoutShebang = hookCode.replace(/^#!.*\n/, '');
  new Function(codeWithoutShebang);
});

test('claude-code-hook.cjs has correct event mappings', () => {
  const hookCode = fs.readFileSync(HOOK_SCRIPT, 'utf-8');
  assertTrue(hookCode.includes('SessionStart'), 'Should handle SessionStart');
  assertTrue(hookCode.includes('PreToolUse'), 'Should handle PreToolUse');
  assertTrue(hookCode.includes('PostToolUse'), 'Should handle PostToolUse');
  assertTrue(hookCode.includes('Stop'), 'Should handle Stop');
  assertTrue(hookCode.includes('SessionEnd'), 'Should handle SessionEnd');
});

test('claude-code-hook.cjs ignores SubagentStop', () => {
  const hookCode = fs.readFileSync(HOOK_SCRIPT, 'utf-8');
  assertTrue(hookCode.includes('IGNORED_EVENTS'), 'Should have IGNORED_EVENTS');
  assertTrue(hookCode.includes("'SubagentStop'"), 'Should ignore SubagentStop');
});

test('claude-code-hook.cjs ignores Notification', () => {
  const hookCode = fs.readFileSync(HOOK_SCRIPT, 'utf-8');
  assertTrue(hookCode.includes("'Notification'"), 'Should ignore Notification');
});

// Test Claude Code events via update-dashboard-status.py
console.log('\n--- Claude Code Status Updates (via Python hook) ---\n');

cleanProjectState();

test('sessionStart: claude-code agent becomes working', () => {
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

test('preToolUse LS: claude-code is reading (not editing)', () => {
  runPythonHook('preToolUse', { tool_name: 'ls' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'reading');
});

test('preToolUse TodoWrite: claude-code is planning (not editing)', () => {
  runPythonHook('preToolUse', { tool_name: 'todowrite' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'planning');
});

test('preToolUse Edit: claude-code is editing', () => {
  runPythonHook('preToolUse', { tool_name: 'edit' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'editing');
});

test('preToolUse MultiEdit: claude-code is editing', () => {
  runPythonHook('preToolUse', { tool_name: 'multiedit' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'editing');
});

test('preToolUse NotebookEdit: claude-code is editing', () => {
  runPythonHook('preToolUse', { tool_name: 'notebookedit' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'editing');
});

test('preToolUse Bash: claude-code is running', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'npm test' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'running');
});

test('preToolUse Bash with git status: claude-code is github', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'git status' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'github');
});

test('preToolUse Bash with cd && gh: claude-code is github', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'cd /tmp && gh pr list' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'github');
});

test('preToolUse Bash with git commit: claude-code is github', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'git commit -m "test"' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'github');
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

// Test TTL feature in set-agent-status.sh (uses temp dir)
console.log('\n--- TTL Feature Tests (temp dir) ---\n');

setupTempDir();

test('set-agent-status.sh: TTL in seconds', () => {
  const result = runStatusScript('metabee', 'working', ['-a', 'reading', '-t', '300']);
  assertEqual(result.status, 0, 'Script should exit successfully');
  const data = readTempExternalAgents();
  assertEqual(data.agents.metabee?.ttlSeconds, 300);
  assertTrue(data.agents.metabee?.expiresAt, 'Should have expiresAt');
});

test('set-agent-status.sh: TTL in minutes (5m)', () => {
  runStatusScript('metabee', 'working', ['-a', 'thinking', '-t', '5m']);
  const data = readTempExternalAgents();
  assertEqual(data.agents.metabee?.ttlSeconds, 300);
});

test('set-agent-status.sh: TTL in hours (1h)', () => {
  runStatusScript('metabee', 'working', ['-a', 'planning', '-t', '1h']);
  const data = readTempExternalAgents();
  assertEqual(data.agents.metabee?.ttlSeconds, 3600);
});

test('set-agent-status.sh: TTL compound format (1h30m)', () => {
  runStatusScript('metabee', 'working', ['-a', 'reading', '-t', '1h30m']);
  const data = readTempExternalAgents();
  assertEqual(data.agents.metabee?.ttlSeconds, 5400);
});

test('set-agent-status.sh: TTL max limit (2h) fails for 3h', () => {
  const result = runStatusScript('metabee', 'working', ['-a', 'reading', '-t', '3h']);
  assertNotEqual(result.status, 0, 'Should fail for TTL > 2h');
});

test('set-agent-status.sh: rejects -t 0', () => {
  const result = runStatusScript('metabee', 'working', ['-a', 'reading', '-t', '0']);
  assertNotEqual(result.status, 0, 'Should fail for TTL = 0');
  assertTrue(result.stderr.includes('Invalid TTL'), 'Should print error message');
});

test('set-agent-status.sh: rejects invalid TTL (abc)', () => {
  const result = runStatusScript('metabee', 'working', ['-a', 'reading', '-t', 'abc']);
  assertNotEqual(result.status, 0, 'Should fail for invalid TTL');
  assertTrue(result.stderr.includes('Invalid TTL'), 'Should print error message');
});

test('set-agent-status.sh: rejects invalid TTL (5x)', () => {
  const result = runStatusScript('metabee', 'working', ['-a', 'reading', '-t', '5x']);
  assertNotEqual(result.status, 0, 'Should fail for invalid TTL');
  assertTrue(result.stderr.includes('Invalid TTL'), 'Should print error message');
});

test('set-agent-status.sh: default TTL is 120 seconds', () => {
  runStatusScript('grokbot', 'working', ['-a', 'thinking']);
  const data = readTempExternalAgents();
  assertEqual(data.agents.grokbot?.ttlSeconds, 120);
});

// Test waiting-on feature
console.log('\n--- Waiting-on Feature Tests ---\n');

test('set-agent-status.sh: --waiting-on sets waitingOn field', () => {
  runStatusScript('metabee', 'working', ['-a', 'waiting', '--waiting-on', 'bc-abc123', '-t', '1h']);
  const data = readTempExternalAgents();
  assertEqual(data.agents.metabee?.waitingOn, 'bc-abc123');
  assertEqual(data.agents.metabee?.activity, 'waiting');
});

test('set-agent-status.sh: --waiting-on implies activity=waiting', () => {
  runStatusScript('metabee', 'working', ['--waiting-on', 'bc-xyz789']);
  const data = readTempExternalAgents();
  assertEqual(data.agents.metabee?.activity, 'waiting');
  assertEqual(data.agents.metabee?.waitingOn, 'bc-xyz789');
});

test('set-agent-status.sh: --waiting-on implies status=working even if idle specified', () => {
  runStatusScript('metabee', 'idle', ['--waiting-on', 'FRIDAY agent']);
  const data = readTempExternalAgents();
  assertEqual(data.agents.metabee?.status, 'working');
  assertEqual(data.agents.metabee?.activity, 'waiting');
  assertEqual(data.agents.metabee?.waitingOn, 'FRIDAY agent');
});

// Test backward compatibility
console.log('\n--- Backward Compatibility Tests ---\n');

test('set-agent-status.sh: works without TTL (uses default)', () => {
  runStatusScript('grokbot', 'working', ['-a', 'github', '-m', 'Pushing']);
  const data = readTempExternalAgents();
  assertEqual(data.agents.grokbot?.status, 'working');
  assertEqual(data.agents.grokbot?.activity, 'github');
  assertEqual(data.agents.grokbot?.ttlSeconds, 120);
});

test('set-agent-status.sh: idle status still works', () => {
  runStatusScript('grokbot', 'idle');
  const data = readTempExternalAgents();
  assertEqual(data.agents.grokbot?.status, 'idle');
});

test('set-agent-status.sh: all activity types still valid', () => {
  const activities = ['planning', 'thinking', 'reading', 'editing', 'running', 'researching', 'github', 'waiting'];
  for (const activity of activities) {
    const result = runStatusScript('testbot', 'working', ['-a', activity]);
    assertEqual(result.status, 0, `Activity ${activity} should be valid`);
  }
});

// Cleanup
cleanupTempDir();

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
