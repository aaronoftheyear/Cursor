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

function runRunner(runnerPath, envExtra = {}) {
  const out = execFileSync(tsxBin, [runnerPath], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...envExtra },
  })
    .trim()
    .split('\n')
    .pop();
  return JSON.parse(out);
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

  const out = runRunner(runner, { PATH: `${fakeBin}:${process.env.PATH}` });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (out.lines.length < 2) throw new Error(`expected 2 runs, got ${out.lines.length}`);
  if (out.lines[0] !== 'sessionStart') throw new Error(`first must be sessionStart, got ${out.lines[0]}`);
  if (out.lines[1] !== 'preToolUse') throw new Error(`second must be preToolUse, got ${out.lines[1]}`);
});

test('coalesced duplicate activity is applied last (reading → editing → running → editing)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'py-seq-'));
  const logFile = path.join(tmp, 'python-seq.log');
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBin, 'python3'),
    `#!/bin/sh
payload=$(cat)
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -1)
echo "$2:$tool" >> "${logFile}"
sleep 0.12
`,
    { mode: 0o755 }
  );

  const runner = path.join(tmp, 'seq-runner.mts');
  fs.writeFileSync(
    runner,
    `
import fs from 'node:fs';
import { applyEventViaPython, resetPythonApplyQueue, waitForPythonApplyIdle } from '${PROJECT_ROOT}/server/agentActivity/applyViaPython.ts';

resetPythonApplyQueue();
const root = '${PROJECT_ROOT.replace(/'/g, "\\'")}';
const base = {
  ts: Date.now(),
  source: 'claude-session-log' as const,
  providerId: 't',
  agentId: 'claude-code',
};
const payload = { session_id: 'seq', source: 'claude-code', claude_code: true };

const enqueue = (activity: string, tool: string) =>
  applyEventViaPython(root, {
    ...base,
    id: activity + tool,
    kind: 'activity',
    activity,
    cursorEvent: 'preToolUse',
    hookPayload: { ...payload, tool_name: tool },
  });

enqueue('reading', 'read');
await new Promise((r) => setTimeout(r, 20));
enqueue('editing', 'edit');
enqueue('running', 'bash');
enqueue('editing', 'edit');

await waitForPythonApplyIdle();
const lines = fs.readFileSync('${logFile.replace(/'/g, "\\'")}', 'utf-8').trim().split('\\n').filter(Boolean);
const last = lines[lines.length - 1] || '';
console.log(JSON.stringify({ last, lines }));
`
  );

  const out = runRunner(runner, { PATH: `${fakeBin}:${process.env.PATH}` });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!out.last.endsWith(':edit')) {
    throw new Error(`final applied status must be edit, got ${out.last} (full log: ${out.lines.join(', ')})`);
  }
});

test('same agent never runs two python jobs in parallel', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'py-peak-'));
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBin, 'python3'),
    `#!/bin/sh
sleep 0.15
`,
    { mode: 0o755 }
  );

  const runner = path.join(tmp, 'peak-runner.mts');
  fs.writeFileSync(
    runner,
    `
import { applyEventViaPython, resetPythonApplyQueue, waitForPythonApplyIdle, getPythonApplyConcurrencyForTests } from '${PROJECT_ROOT}/server/agentActivity/applyViaPython.ts';

resetPythonApplyQueue();
const root = '${PROJECT_ROOT.replace(/'/g, "\\'")}';
const base = {
  ts: Date.now(),
  source: 'claude-session-log' as const,
  providerId: 't',
  agentId: 'claude-code',
};
const payload = { session_id: 'peak', source: 'claude-code', claude_code: true };

applyEventViaPython(root, { ...base, id: 'a', kind: 'activity', activity: 'reading', cursorEvent: 'preToolUse', hookPayload: { ...payload, tool_name: 'read' } });
applyEventViaPython(root, { ...base, id: 'b', kind: 'activity', activity: 'editing', cursorEvent: 'preToolUse', hookPayload: { ...payload, tool_name: 'edit' } });

await waitForPythonApplyIdle();
const { peakGlobalRunning } = getPythonApplyConcurrencyForTests();
console.log(JSON.stringify({ peakGlobalRunning }));
`
  );

  const out = runRunner(runner, { PATH: `${fakeBin}:${process.env.PATH}` });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (out.peakGlobalRunning > 1) {
    throw new Error(`expected peak 1 for single agent, got ${out.peakGlobalRunning}`);
  }
});

test('global cap limits concurrent python across agents', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'py-cap-'));
  const fakeBin = path.join(tmp, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBin, 'python3'),
    `#!/bin/sh
sleep 0.2
`,
    { mode: 0o755 }
  );

  const runner = path.join(tmp, 'cap-runner.mts');
  fs.writeFileSync(
    runner,
    `
import { applyEventViaPython, resetPythonApplyQueue, waitForPythonApplyIdle, getPythonApplyConcurrencyForTests } from '${PROJECT_ROOT}/server/agentActivity/applyViaPython.ts';

resetPythonApplyQueue();
const root = '${PROJECT_ROOT.replace(/'/g, "\\'")}';
const mk = (agentId: string) => ({
  ts: Date.now(),
  source: 'claude-session-log' as const,
  providerId: 't',
  agentId,
});
const payload = { session_id: 'cap', source: 'claude-code', claude_code: true };

applyEventViaPython(root, { ...mk('a'), id: '1', kind: 'activity', activity: 'reading', cursorEvent: 'preToolUse', hookPayload: { ...payload, tool_name: 'read' } });
applyEventViaPython(root, { ...mk('b'), id: '2', kind: 'activity', activity: 'reading', cursorEvent: 'preToolUse', hookPayload: { ...payload, tool_name: 'read' } });
applyEventViaPython(root, { ...mk('c'), id: '3', kind: 'activity', activity: 'reading', cursorEvent: 'preToolUse', hookPayload: { ...payload, tool_name: 'read' } });

await waitForPythonApplyIdle();
const { peakGlobalRunning, maxConcurrent } = getPythonApplyConcurrencyForTests();
console.log(JSON.stringify({ peakGlobalRunning, maxConcurrent }));
`
  );

  const out = runRunner(runner, { PATH: `${fakeBin}:${process.env.PATH}` });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (out.maxConcurrent !== 2) throw new Error(`expected cap 2, got ${out.maxConcurrent}`);
  if (out.peakGlobalRunning > 2) {
    throw new Error(`expected peak <= 2 across agents, got ${out.peakGlobalRunning}`);
  }
});

console.log(`\n=== applyViaPython: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
