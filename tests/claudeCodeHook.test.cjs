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

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOOK_SCRIPT = path.join(PROJECT_ROOT, '.cursor', 'hooks', 'claude-code-hook.cjs');
const UPDATE_SCRIPT = path.join(PROJECT_ROOT, '.cursor', 'hooks', 'update-dashboard-status.py');
const STATUS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'set-agent-status.sh');

let passed = 0;
let failed = 0;
let tempDir = null;
let pythonTempDir = null;

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

// Setup temp directory for external agent tests
function setupTempDir() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-test-'));
  fs.mkdirSync(path.join(tempDir, '.dashboard'), { recursive: true });
  return tempDir;
}

// Setup temp directory for Python hook tests (uses temp .dashboard)
function setupPythonTempDir() {
  pythonTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-python-test-'));
  fs.mkdirSync(path.join(pythonTempDir, '.dashboard'), { recursive: true });
  fs.mkdirSync(path.join(pythonTempDir, 'public', 'assets'), { recursive: true });
  
  // Copy agent-links.json to temp dir for proper routing
  const srcLinks = path.join(PROJECT_ROOT, 'public', 'assets', 'agent-links.json');
  const destLinks = path.join(pythonTempDir, 'public', 'assets', 'agent-links.json');
  if (fs.existsSync(srcLinks)) {
    fs.copyFileSync(srcLinks, destLinks);
  }
  
  // Create empty live-status.json in public for mirror writes
  const publicStatus = path.join(pythonTempDir, 'public', 'live-status.json');
  fs.writeFileSync(publicStatus, '{}');
  
  return pythonTempDir;
}

function cleanupTempDir() {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function cleanupPythonTempDir() {
  if (pythonTempDir && fs.existsSync(pythonTempDir)) {
    fs.rmSync(pythonTempDir, { recursive: true, force: true });
  }
}

function readStatus() {
  const statusFile = path.join(pythonTempDir, '.dashboard', 'live-status.json');
  try {
    return JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
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

// Run the Python hook script with Claude-style payload (uses pythonTempDir)
function runPythonHook(event, payload = {}) {
  const fullPayload = {
    ...payload,
    generation_id: `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    session_id: payload.session_id || 'test-claude-session',
    timestamp: Date.now(),
    workspace_roots: [pythonTempDir],
    source: 'claude-code',
    claude_code: true,
    agent_name: 'claude-code',
  };

  const result = spawnSync('python3', [UPDATE_SCRIPT, event], {
    input: JSON.stringify(fullPayload),
    encoding: 'utf-8',
    cwd: pythonTempDir,
    env: {
      ...process.env,
      DASHBOARD_PROJECT_ROOT: pythonTempDir,
    },
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

// Test real .cjs hook file piping to Python
console.log('\n--- Real .cjs Hook Integration Tests ---\n');

// Keep a persistent temp dir for real hook tests
let realHookTempDir = null;

function setupRealHookTempDir() {
  realHookTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-hook-test-'));
  fs.mkdirSync(path.join(realHookTempDir, '.dashboard'), { recursive: true });
  fs.mkdirSync(path.join(realHookTempDir, 'public', 'assets'), { recursive: true });
  
  const srcLinks = path.join(PROJECT_ROOT, 'public', 'assets', 'agent-links.json');
  const destLinks = path.join(realHookTempDir, 'public', 'assets', 'agent-links.json');
  if (fs.existsSync(srcLinks)) {
    fs.copyFileSync(srcLinks, destLinks);
  }
  fs.writeFileSync(path.join(realHookTempDir, 'public', 'live-status.json'), '{}');
  
  // Clear seen events for deduplication
  const seenEventsPath = path.join(realHookTempDir, '.dashboard', 'seen-events.json');
  fs.writeFileSync(seenEventsPath, '{"events":{}}');
  
  return realHookTempDir;
}

function cleanupRealHookTempDir() {
  if (realHookTempDir && fs.existsSync(realHookTempDir)) {
    fs.rmSync(realHookTempDir, { recursive: true, force: true });
  }
}

function readRealHookStatus() {
  const statusPath = path.join(realHookTempDir, '.dashboard', 'live-status.json');
  try {
    return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
  } catch {
    return null;
  }
}

// Run the real .cjs hook - it pipes to Python which writes status
// Claude Code passes hook_event_name in the payload, not command line
function runRealHook(claudeEvent, payload = {}) {
  const fullPayload = {
    ...payload,
    hook_event_name: claudeEvent, // This is what the hook script looks for
    generation_id: `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    session_id: payload.session_id || 'real-hook-session',
    timestamp: Date.now(),
    cwd: realHookTempDir, // Needed for workspace_roots
  };
  
  const result = spawnSync('node', [HOOK_SCRIPT], {
    input: JSON.stringify(fullPayload),
    encoding: 'utf-8',
    cwd: realHookTempDir,
    env: {
      ...process.env,
      DASHBOARD_PROJECT_ROOT: realHookTempDir,
    },
  });
  
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    status: readRealHookStatus(),
  };
}

setupRealHookTempDir();

test('Real hook: SessionStart sets agent to working', () => {
  const result = runRealHook('SessionStart', { session_id: 'test-session-1' });
  assertEqual(result.status?.agents?.['claude-code']?.status, 'working', 'Should be working after SessionStart');
});

test('Real hook: SubagentStop is ignored (agent stays working)', () => {
  // Agent should already be working from previous test
  const before = readRealHookStatus();
  assertEqual(before?.agents?.['claude-code']?.status, 'working', 'Precondition: should be working');
  
  // Send SubagentStop - should be ignored, agent stays working
  const result = runRealHook('SubagentStop', { session_id: 'test-session-1' });
  // SubagentStop is in IGNORED_EVENTS, so nothing should change
  assertEqual(result.status?.agents?.['claude-code']?.status, 'working', 
    'SubagentStop should NOT change agent status');
});

test('Real hook: Stop event sets agent to idle', () => {
  const result = runRealHook('Stop', { session_id: 'test-session-1' });
  assertEqual(result.status?.agents?.['claude-code']?.status, 'idle', 'Stop should set agent to idle');
});

test('Real hook: PreToolUse with Read sets activity to reading', () => {
  // Start fresh session
  runRealHook('SessionStart', { session_id: 'test-session-2' });
  
  const result = runRealHook('PreToolUse', { 
    session_id: 'test-session-2',
    tool_name: 'Read',
    tool_input: { path: '/some/file.txt' }
  });
  assertEqual(result.status?.agents?.['claude-code']?.activity, 'reading');
});

cleanupRealHookTempDir();

// Test Claude Code events via update-dashboard-status.py
console.log('\n--- Claude Code Status Updates (via Python hook) ---\n');

setupPythonTempDir();

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

test('preToolUse Bash with "echo high score": NOT github (substring fix)', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'echo high score' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'running');
});

test('preToolUse Bash with "echo gh is great": NOT github', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'echo gh is great' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'running');
});

test('preToolUse Bash with "sudo gh pr list": IS github', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'sudo gh pr list' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'github');
});

test('preToolUse Bash with "FOO=1 gh pr view": IS github (env var prefix)', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'FOO=1 gh pr view' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'github');
});

test('preToolUse Bash with "git -C repo status": IS github (git with options)', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'git -C /path/to/repo status' });
  const status = readStatus();
  assertEqual(status?.agents?.['claude-code']?.activity, 'github');
});

test('preToolUse Bash with "GIT_DIR=/x git --git-dir=/y push": IS github', () => {
  runPythonHook('preToolUse', { tool_name: 'bash', command: 'GIT_DIR=/x git --git-dir=/y push' });
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

// Cleanup Python temp dir
cleanupPythonTempDir();

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

// Test vite merge logic using the REAL module with fetch mocked
console.log('\n--- Vite Merge Logic Tests (real module) ---\n');

// We need to run these tests async since the real module is async
async function runMergeLogicTests() {
  // Dynamic import of the compiled TypeScript module
  // Use tsx to run the TypeScript directly
  const { execSync } = require('child_process');
  
  // Create a test runner script that imports and tests the real module
  const testScript = `
    import { mergeExternalAgents, checkWaitingOnFinished, clearFailedBcIdCache, fetchCloudAgentById, agentsChanged, createUpdatedAtState, computeUpdatedAt } from '${PROJECT_ROOT}/server/liveStatusMerge.ts';
    
    // Mock fetch function for testing
    function createMockFetch(responses) {
      return async (url) => {
        const response = responses[url];
        if (!response) {
          return { ok: false, status: 404 };
        }
        return {
          ok: true,
          json: async () => response,
        };
      };
    }
    
    const results = [];
    
    async function test(name, fn) {
      try {
        await fn();
        results.push({ name, passed: true });
      } catch (err) {
        results.push({ name, passed: false, error: err.message });
      }
    }
    
    function assertEqual(actual, expected, msg = '') {
      if (actual !== expected) {
        throw new Error(\`Expected \${JSON.stringify(expected)}, got \${JSON.stringify(actual)}. \${msg}\`);
      }
    }
    
    function assertTrue(value, msg = '') {
      if (!value) {
        throw new Error(\`Expected truthy value, got \${JSON.stringify(value)}. \${msg}\`);
      }
    }
    
    // Clear cache before tests
    clearFailedBcIdCache();
    
    await test('TTL expiry sets agent to idle', async () => {
      const live = { agents: {} };
      const external = {
        agents: {
          metabee: {
            status: 'working',
            activity: 'waiting',
            updatedAt: new Date(Date.now() - 200_000).toISOString(),
            detail: 'Waiting on something',
          }
        }
      };
      const cloudCache = new Map();
      const mockFetch = createMockFetch({});
      
      const result = await mergeExternalAgents(live, external, undefined, cloudCache, mockFetch);
      assertEqual(result.agents.metabee?.status, 'idle', 'Expired agent should be idle');
      assertTrue(result.agents.metabee?.detail?.includes('expired'), 'Should mention expired');
    });
    
    await test('Custom TTL expiresAt respected', async () => {
      const live = { agents: {} };
      const external = {
        agents: {
          metabee: {
            status: 'working',
            activity: 'waiting',
            updatedAt: new Date(Date.now() - 10_000).toISOString(),
            expiresAt: new Date(Date.now() - 1000).toISOString(),
            detail: 'Waiting',
          }
        }
      };
      const cloudCache = new Map();
      const mockFetch = createMockFetch({});
      
      const result = await mergeExternalAgents(live, external, undefined, cloudCache, mockFetch);
      assertEqual(result.agents.metabee?.status, 'idle', 'Should be idle when expiresAt passed');
    });
    
    await test('Custom TTL not expired keeps agent working', async () => {
      const live = { agents: {} };
      const external = {
        agents: {
          metabee: {
            status: 'working',
            activity: 'thinking',
            updatedAt: new Date(Date.now() - 200_000).toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            detail: 'Thinking hard',
          }
        }
      };
      const cloudCache = new Map();
      const mockFetch = createMockFetch({});
      
      const result = await mergeExternalAgents(live, external, undefined, cloudCache, mockFetch);
      assertEqual(result.agents.metabee?.status, 'working', 'Should stay working until expiresAt');
    });
    
    await test('Empty cloud agent name does not match waiting-on', async () => {
      const live = { agents: {} };
      const external = {
        agents: {
          metabee: {
            status: 'working',
            activity: 'waiting',
            waitingOn: 'friday-agent',
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }
        }
      };
      
      const cloudCache = new Map();
      cloudCache.set('bc-empty', {
        status: 'idle',
        cloudAgentId: 'bc-empty',
        cloudAgentName: '',
      });
      const mockFetch = createMockFetch({});
      
      const result = await mergeExternalAgents(live, external, undefined, cloudCache, mockFetch);
      assertEqual(result.agents.metabee?.status, 'working', 'Empty name should not match');
    });
    
    await test('bc-id direct match clears waiting-on', async () => {
      const live = { agents: {} };
      const external = {
        agents: {
          metabee: {
            status: 'working',
            activity: 'waiting',
            waitingOn: 'bc-test-123',
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }
        }
      };
      
      const cloudCache = new Map();
      cloudCache.set('bc-test-123', {
        status: 'idle',
        cloudAgentId: 'bc-test-123',
        cloudAgentName: 'Test Agent',
      });
      const mockFetch = createMockFetch({});
      
      const result = await mergeExternalAgents(live, external, undefined, cloudCache, mockFetch);
      assertEqual(result.agents.metabee?.status, 'idle', 'Should be idle when bc-id match is idle');
      assertTrue(result.agents.metabee?.detail?.includes('finished'), 'Should mention finished');
    });
    
    await test('Name match clears waiting-on (case insensitive)', async () => {
      const live = { agents: {} };
      const external = {
        agents: {
          metabee: {
            status: 'working',
            activity: 'waiting',
            waitingOn: 'FRIDAY Agent',
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }
        }
      };
      
      const cloudCache = new Map();
      cloudCache.set('bc-friday', {
        status: 'idle',
        cloudAgentId: 'bc-friday',
        cloudAgentName: 'friday agent',
      });
      const mockFetch = createMockFetch({});
      
      const result = await mergeExternalAgents(live, external, undefined, cloudCache, mockFetch);
      assertEqual(result.agents.metabee?.status, 'idle', 'Case-insensitive name match should clear');
    });
    
    await test('Running cloud agent does not clear waiting-on', async () => {
      const live = { agents: {} };
      const external = {
        agents: {
          metabee: {
            status: 'working',
            activity: 'waiting',
            waitingOn: 'bc-running',
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }
        }
      };
      
      const cloudCache = new Map();
      cloudCache.set('bc-running', {
        status: 'working',
        cloudAgentId: 'bc-running',
        cloudAgentName: 'Running Agent',
      });
      const mockFetch = createMockFetch({});
      
      const result = await mergeExternalAgents(live, external, undefined, cloudCache, mockFetch);
      assertEqual(result.agents.metabee?.status, 'working', 'Should stay working while waited-on agent is running');
    });
    
    await test('bc-id fetch works when not in cache', async () => {
      clearFailedBcIdCache();
      const live = { agents: {} };
      const external = {
        agents: {
          metabee: {
            status: 'working',
            activity: 'waiting',
            waitingOn: 'bc-fetched-123',
            updatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }
        }
      };
      
      const cloudCache = new Map(); // Empty - will need to fetch
      const mockFetch = createMockFetch({
        'https://api.cursor.com/v1/agents/bc-fetched-123': {
          id: 'bc-fetched-123',
          name: 'Fetched Agent',
          latestRunId: 'run-1',
        },
        'https://api.cursor.com/v1/agents/bc-fetched-123/runs/run-1': {
          status: 'FINISHED',
          result: 'Done',
        },
      });
      
      const result = await mergeExternalAgents(live, external, 'test-api-key', cloudCache, mockFetch);
      assertEqual(result.agents.metabee?.status, 'idle', 'Should be idle after fetching finished agent');
    });
    
    // Test that failed bc-id lookups are cached (count mock fetch calls)
    await test('Failed bc-id lookup is cached for 30s (not re-fetched)', async () => {
      clearFailedBcIdCache();
      let fetchCallCount = 0;
      
      const countingMockFetch = async (url) => {
        fetchCallCount++;
        return { ok: false, status: 404 };
      };
      
      // First call - should fetch and fail
      const result1 = await fetchCloudAgentById('bc-not-found', 'test-key', countingMockFetch);
      assertEqual(result1, null, 'First call should return null');
      assertEqual(fetchCallCount, 1, 'First call should make exactly 1 fetch');
      
      // Second call within 30s - should NOT fetch (cached)
      const result2 = await fetchCloudAgentById('bc-not-found', 'test-key', countingMockFetch);
      assertEqual(result2, null, 'Second call should return null');
      assertEqual(fetchCallCount, 1, 'Second call should NOT make another fetch (cached 404)');
      
      // Third call - still cached
      const result3 = await fetchCloudAgentById('bc-not-found', 'test-key', countingMockFetch);
      assertEqual(result3, null, 'Third call should return null');
      assertEqual(fetchCallCount, 1, 'Third call should NOT make another fetch (still cached)');
    });
    
    // Test agentsChanged includes activityDepth
    await test('agentsChanged detects activityDepth changes', async () => {
      const before = { agent1: { status: 'working', activity: 'reading', activityDepth: 'brief' } };
      const after = { agent1: { status: 'working', activity: 'reading', activityDepth: 'deep' } };
      
      const changed = agentsChanged(before, after);
      assertTrue(changed, 'Should detect activityDepth change from brief to deep');
    });
    
    await test('agentsChanged returns false when identical (including activityDepth)', async () => {
      const before = { agent1: { status: 'working', activity: 'reading', activityDepth: 'deep', detail: 'Test' } };
      const after = { agent1: { status: 'working', activity: 'reading', activityDepth: 'deep', detail: 'Test' } };
      
      const changed = agentsChanged(before, after);
      assertTrue(!changed, 'Should return false when agents are identical');
    });
    
    // Test computeUpdatedAt logic with injectable clock
    // These tests use injected timestamps to deterministically test behavior
    
    await test('computeUpdatedAt: unchanged polls keep same timestamp (catches always-bump bug)', async () => {
      const state = createUpdatedAtState();
      const agents = { agent1: { status: 'working', activity: 'reading' } };
      
      // Inject a clock that returns different times on each call
      let callCount = 0;
      const injectedNow = () => {
        callCount++;
        return '2024-01-01T00:00:0' + callCount + '.000Z';
      };
      
      // First call - sets initial timestamp
      const ts1 = computeUpdatedAt(agents, state, injectedNow);
      assertEqual(ts1, '2024-01-01T00:00:01.000Z', 'First call uses clock');
      
      // Subsequent calls with SAME agents - must return SAME timestamp
      // If code has "always bump" bug, ts2 would be 02, ts3 would be 03, etc.
      const ts2 = computeUpdatedAt(agents, state, injectedNow);
      const ts3 = computeUpdatedAt(agents, state, injectedNow);
      const ts4 = computeUpdatedAt(agents, state, injectedNow);
      
      assertEqual(ts2, ts1, 'Second poll must keep ts1 (catches always-bump)');
      assertEqual(ts3, ts1, 'Third poll must keep ts1');
      assertEqual(ts4, ts1, 'Fourth poll must keep ts1');
    });
    
    await test('computeUpdatedAt: changed agents bump timestamp (catches never-bump bug)', async () => {
      const state = createUpdatedAtState();
      
      let callCount = 0;
      const injectedNow = () => {
        callCount++;
        return '2024-01-01T00:00:0' + callCount + '.000Z';
      };
      
      // First call with idle agent
      const ts1 = computeUpdatedAt({ agent1: { status: 'idle' } }, state, injectedNow);
      assertEqual(ts1, '2024-01-01T00:00:01.000Z', 'First call uses clock');
      
      // Second call with CHANGED agent - must bump timestamp
      // If code has "never bump" bug, ts2 would still be ts1
      const ts2 = computeUpdatedAt({ agent1: { status: 'working' } }, state, injectedNow);
      assertEqual(ts2, '2024-01-01T00:00:02.000Z', 'Changed agent must bump (catches never-bump)');
      
      // Verify state was updated
      assertEqual(state.lastSentUpdatedAt, ts2, 'State should have new timestamp');
    });
    
    await test('computeUpdatedAt: second change also bumps (catches stale-lastSentAgents bug)', async () => {
      const state = createUpdatedAtState();
      
      let callCount = 0;
      const injectedNow = () => {
        callCount++;
        return '2024-01-01T00:00:0' + callCount + '.000Z';
      };
      
      // First call - idle
      const ts1 = computeUpdatedAt({ agent1: { status: 'idle' } }, state, injectedNow);
      assertEqual(ts1, '2024-01-01T00:00:01.000Z');
      
      // Second call - working (change #1)
      const ts2 = computeUpdatedAt({ agent1: { status: 'working' } }, state, injectedNow);
      assertEqual(ts2, '2024-01-01T00:00:02.000Z', 'First change bumps');
      
      // Third call - back to idle (change #2)
      // If lastSentAgents wasn't updated properly, this would NOT bump
      const ts3 = computeUpdatedAt({ agent1: { status: 'idle' } }, state, injectedNow);
      assertEqual(ts3, '2024-01-01T00:00:03.000Z', 'Second change must also bump (catches stale-lastSentAgents)');
      
      // Fourth call - same as third, should NOT bump
      const ts4 = computeUpdatedAt({ agent1: { status: 'idle' } }, state, injectedNow);
      assertEqual(ts4, ts3, 'Unchanged after second change keeps ts3');
    });
    
    console.log(JSON.stringify(results));
  `;
  
  const testScriptPath = path.join(os.tmpdir(), 'merge-test-' + Date.now() + '.mts');
  fs.writeFileSync(testScriptPath, testScript);
  
  // Use local tsx binary (from node_modules) - must work offline after npm ci
  // execFileSync with array args handles paths with spaces correctly
  const tsxBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
  
  try {
    const output = execFileSync(tsxBin, [testScriptPath], {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      timeout: 30000,
    });
    
    const results = JSON.parse(output.trim());
    for (const result of results) {
      if (result.passed) {
        console.log(`✓ ${result.name}`);
        passed++;
      } else {
        console.log(`✗ ${result.name}`);
        console.log(`  Error: ${result.error}`);
        failed++;
      }
    }
  } catch (err) {
    console.log('✗ Merge logic tests failed to run');
    console.log(`  Error: ${err.message}`);
    if (err.stdout) console.log(`  stdout: ${err.stdout}`);
    if (err.stderr) console.log(`  stderr: ${err.stderr}`);
    failed++;
  } finally {
    try { fs.unlinkSync(testScriptPath); } catch {}
  }
}

// Run the async merge logic tests
runMergeLogicTests().then(() => {
  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
