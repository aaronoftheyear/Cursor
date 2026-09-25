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

function runEval(scriptBody) {
  const out = execFileSync(tsxBin, ['--eval', scriptBody], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
  }).trim();
  return JSON.parse(out.split('\n').filter(Boolean).pop());
}

test('missing python3 does not throw', () => {
  const out = runEval(`
    import { applyEventViaPython, resetPythonApplyQueue } from '${PROJECT_ROOT}/server/agentActivity/applyViaPython.ts';
    resetPythonApplyQueue();
    const prev = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      applyEventViaPython('${PROJECT_ROOT.replace(/'/g, "\\'")}', {
        id: 't1',
        ts: Date.now(),
        source: 'claude-session-log',
        providerId: 't',
        agentId: 'claude-code',
        kind: 'turnEnd',
        cursorEvent: 'stop',
        hookPayload: { session_id: 's', source: 'claude-code', claude_code: true },
      });
      console.log(JSON.stringify({ ok: true }));
    } finally {
      process.env.PATH = prev;
    }
  `);
  if (!out.ok) throw new Error('expected ok');
});

test('same agent preserves python invocation order under concurrency', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'py-order-'));
  const logFile = path.join(tmp, 'python-order.log');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBin, 'python3'),
    `#!/bin/sh
echo "$2" >> "${logFile}"
sleep 0.08
`,
    { mode: 0o755 }
  );

  const runner = path.join(tmp, 'order-runner.mts');
  fs.writeFileSync(
    runner,
    `
import fs from 'node:fs';
import { applyEventViaPython, resetPythonApplyQueue, waitForPythonApplyIdle } from '${PROJECT_ROOT}/server/agentActivity/applyViaPython.ts';

resetPythonApplyQueue();
const root = '${PROJECT_ROOT.replace(/'/g, "\\'")}';
const payload = { session_id: 'order-s', source: 'claude-code', claude_code: true };
const base = {
  ts: Date.now(),
  source: 'claude-session-log' as const,
  providerId: 't',
  agentId: 'claude-code',
};

applyEventViaPython(root, { ...base, id: '1', kind: 'sessionStart', cursorEvent: 'sessionStart', hookPayload: payload });
applyEventViaPython(root, {
  ...base,
  id: '2',
  kind: 'activity',
  activity: 'editing',
  cursorEvent: 'preToolUse',
  hookPayload: { ...payload, tool_name: 'edit' },
});

await waitForPythonApplyIdle();
const lines = fs.readFileSync('${logFile.replace(/'/g, "\\'")}', 'utf-8').trim().split('\\n').filter(Boolean);
console.log(JSON.stringify({ lines }));
`
  );

  const out = JSON.parse(
    execFileSync(tsxBin, [runner], {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    })
      .trim()
      .split('\n')
      .pop()
  );

  fs.rmSync(tmp, { recursive: true, force: true });
  if (out.lines.length < 2) throw new Error(`expected 2 runs, got ${out.lines.length}`);
  if (out.lines[0] !== 'sessionStart') throw new Error(`first must be sessionStart, got ${out.lines[0]}`);
  if (out.lines[1] !== 'preToolUse') throw new Error(`second must be preToolUse, got ${out.lines[1]}`);
});

console.log(`\n=== applyViaPython: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
