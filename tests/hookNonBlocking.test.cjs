#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOOK_SCRIPT = path.join(PROJECT_ROOT, '.cursor', 'hooks', 'claude-code-hook.cjs');

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

function runHook(payload, envExtra = {}) {
  return spawnSync('node', [HOOK_SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    env: { ...process.env, ...envExtra },
    timeout: 3000,
  });
}

test('hook uses detached spawn (no http forward)', () => {
  const code = fs.readFileSync(HOOK_SCRIPT, 'utf-8');
  if (!code.includes('detached: true')) throw new Error('missing detached spawn');
  if (!code.includes('child.unref()')) throw new Error('missing unref');
  if (code.includes('http.request')) throw new Error('http forward must be removed');
});

test('hook completes in under 500ms with slow python', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-nb-'));
  const fakeBin = path.join(tempDir, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'python3'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });

  const start = Date.now();
  const result = runHook(
    { hook_event_name: 'SessionStart', session_id: 'nb-test-session', cwd: tempDir },
    {
      DASHBOARD_PROJECT_ROOT: tempDir,
      PATH: `${fakeBin}:${process.env.PATH}`,
      DASHBOARD_HOOK_SYNC: '',
    }
  );
  const elapsed = Date.now() - start;

  spawnSync('pkill', ['-f', 'sleep 30'], { stdio: 'ignore' });
  fs.rmSync(tempDir, { recursive: true, force: true });

  if (result.status !== 0) throw new Error(`exit ${result.status}`);
  if (elapsed > 500) throw new Error(`hook took ${elapsed}ms (expected < 500ms)`);
});

test('hook stdout is empty (no Claude JSON leakage)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-stdout-'));
  const result = runHook(
    {
      hook_event_name: 'PreToolUse',
      session_id: 'stdout-test',
      tool_name: 'Read',
      cwd: tempDir,
    },
    { DASHBOARD_PROJECT_ROOT: tempDir, DASHBOARD_HOOK_SYNC: '1' }
  );
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (result.stdout && result.stdout.trim()) {
    throw new Error(`stdout must be empty, got: ${result.stdout}`);
  }
});

test('hook registers session (sync and detached paths)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-reg-'));
  runHook(
    { hook_event_name: 'SessionStart', session_id: 'reg-session-abc', cwd: tempDir },
    { DASHBOARD_PROJECT_ROOT: tempDir, DASHBOARD_HOOK_SYNC: '' }
  );
  const regPath = path.join(tempDir, '.dashboard', 'hook-sessions.json');
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
  if (!reg.sessions['reg-session-abc']) throw new Error('session not registered');
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('mutation: without registerHookSession registry stays empty', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-mut-'));
  const src = fs.readFileSync(HOOK_SCRIPT, 'utf-8');
  const mutated = src.replace('registerHookSession(projectRoot', '// registerHookSession(projectRoot');
  const mutHook = path.join(tempDir, 'mut-hook.cjs');
  fs.writeFileSync(mutHook, mutated);
  spawnSync('node', [mutHook], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'mut', cwd: tempDir }),
    encoding: 'utf-8',
    env: { ...process.env, DASHBOARD_PROJECT_ROOT: tempDir, DASHBOARD_HOOK_SYNC: '1' },
  });
  if (fs.existsSync(path.join(tempDir, '.dashboard', 'hook-sessions.json'))) {
    throw new Error('mutation should prevent registry write');
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

console.log(`\n=== Hook non-blocking: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
