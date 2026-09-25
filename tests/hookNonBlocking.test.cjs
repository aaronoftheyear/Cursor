#!/usr/bin/env node
/**
 * Hook must return quickly when dashboard / python path is slow or missing.
 */

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

test('hook source uses detached spawn (non-blocking)', () => {
  const code = fs.readFileSync(HOOK_SCRIPT, 'utf-8');
  if (!code.includes('detached: true')) throw new Error('missing detached spawn');
  if (!code.includes('child.unref()')) throw new Error('missing unref');
  if (!code.includes('DASHBOARD_HOOK_SYNC')) throw new Error('sync path should be test-only via env');
  if (!/else\s*\{[\s\S]*forwardDetached/.test(code)) throw new Error('default path should use forwardDetached');
});

test('hook exits 0 quickly when python is a slow no-op', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-nb-'));
  const fakeBin = path.join(tempDir, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const slowPython = path.join(fakeBin, 'python3');
  fs.writeFileSync(slowPython, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });

  const payload = JSON.stringify({
    hook_event_name: 'SessionStart',
    session_id: 'nb-test-session',
    cwd: tempDir,
  });

  const start = Date.now();
  const result = spawnSync('node', [HOOK_SCRIPT], {
    input: payload,
    encoding: 'utf-8',
    cwd: tempDir,
    env: {
      ...process.env,
      DASHBOARD_PROJECT_ROOT: tempDir,
      PATH: `${fakeBin}:${process.env.PATH}`,
      DASHBOARD_HOOK_SYNC: '',
    },
    timeout: 5000,
  });
  const elapsed = Date.now() - start;

  if (result.status !== 0) throw new Error(`exit ${result.status}`);
  if (elapsed > 2000) throw new Error(`hook took ${elapsed}ms (expected < 2s)`);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

console.log(`\n=== Hook non-blocking: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
