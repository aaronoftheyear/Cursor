#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedupe-test-'));

function loadDedupeResult() {
  const script = `
    import { registerHookSession, shouldApplyLogFallbackEvent, isHookOwnedSession } from '${PROJECT_ROOT}/server/agentActivity/hookDedupe.ts';

    const root = '${tempDir.replace(/'/g, "\\'")}';
    registerHookSession(root, 'sess-hook-1');

    const blocked = shouldApplyLogFallbackEvent(root, {
      id: 'x', ts: Date.now(), source: 'claude-session-log', providerId: 'claude-session-log',
      agentId: 'claude-code', kind: 'activity', sessionId: 'sess-hook-1', status: 'working', activity: 'reading',
    });
    const allowed = shouldApplyLogFallbackEvent(root, {
      id: 'y', ts: Date.now(), source: 'claude-session-log', providerId: 'claude-session-log',
      agentId: 'claude-code', kind: 'activity', sessionId: 'sess-log-only', status: 'working', activity: 'reading',
    });
    console.log(JSON.stringify({ blocked, allowed, owned: isHookOwnedSession(root, 'sess-hook-1') }));
  `;
  const out = execFileSync(tsxBin, ['-e', script], { encoding: 'utf-8' }).trim();
  return JSON.parse(out.split('\n').filter(Boolean).pop());
}

const result = loadDedupeResult();

test('hook-owned session blocks log fallback', () => {
  if (result.blocked !== false) throw new Error('expected blocked');
});

test('log-only session allowed', () => {
  if (result.allowed !== true) throw new Error('expected allowed');
});

test('registry marks hook session', () => {
  if (result.owned !== true) throw new Error('expected owned');
});

fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n=== Dedupe: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
