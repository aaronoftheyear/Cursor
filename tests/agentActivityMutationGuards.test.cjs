#!/usr/bin/env node
/**
 * High-signal guards that must fail (assertion) when core fixes are reverted.
 */

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

test('partial line after prior complete lines does not duplicate events', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-partial-'));
  try {
    const logFile = path.join(tmp, 'hist.jsonl');
    const offsets = path.join(tmp, 'offsets.json');
    const prior = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: {} }] } }),
      JSON.stringify({ type: 'system', subtype: 'turn_duration', uuid: '11111111-1111-4111-8111-111111111101' }),
    ].join('\n') + '\n';
    const turnLine = JSON.stringify({
      type: 'system',
      subtype: 'turn_duration',
      uuid: '22222222-2222-4222-8222-222222222222',
    });
    fs.writeFileSync(logFile, prior);
    fs.utimesSync(logFile, new Date(), new Date());

    runEval(`
      import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
      const p = new ClaudeSessionLogProvider(${JSON.stringify(tmp)}, {
        projectsRoot: ${JSON.stringify(tmp)},
        offsetsFile: ${JSON.stringify(offsets)},
      });
      p.start(() => {}); p.stop();
      console.log(JSON.stringify({ ok: true }));
    `);

    const runner = path.join(tmp, 'partial.mts');
    fs.writeFileSync(
      runner,
      `
import fs from 'node:fs';
import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';

const logFile = ${JSON.stringify(logFile)};
const turnLine = ${JSON.stringify(turnLine)};
const events: import('${PROJECT_ROOT}/server/agentActivity/types.ts').AgentEvent[] = [];
const p = new ClaudeSessionLogProvider(${JSON.stringify(tmp)}, {
  projectsRoot: ${JSON.stringify(tmp)},
  offsetsFile: ${JSON.stringify(offsets)},
});
p.start((e) => events.push(e));

const partial = turnLine.slice(0, 20);
fs.appendFileSync(logFile, partial);
p.pollNow();
const afterPartial = events.length;

fs.appendFileSync(logFile, turnLine.slice(20) + '\\n');
p.pollNow();
const turnEnds = events.filter((e) => e.kind === 'turnEnd').length;
const ids = events.map((e) => e.id);
p.stop();
console.log(JSON.stringify({ afterPartial, turnEnds, unique: new Set(ids).size === ids.length, total: events.length }));
`
    );
    const out = JSON.parse(
      execFileSync(tsxBin, [runner], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim().split('\n').pop()
    );
    if (out.afterPartial !== 0) throw new Error(`expected 0 events on partial, got ${out.afterPartial}`);
    if (out.turnEnds !== 1) throw new Error(`expected 1 turnEnd, got ${out.turnEnds}`);
    if (out.total !== 1) throw new Error(`expected 1 total event, got ${out.total}`);
    if (!out.unique) throw new Error('duplicate event ids');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('progress keeps permission timer alive over 1.2s (300ms timer)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-prog-'));
  try {
    const runner = path.join(tmp, 'prog.mts');
    fs.writeFileSync(
      runner,
      `
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';

const tmp = ${JSON.stringify(tmp)};
const logFile = path.join(tmp, 'prog.jsonl');
const offsets = path.join(tmp, 'offsets.json');
fs.writeFileSync(logFile, '');
fs.utimesSync(logFile, new Date(), new Date());
const seed = new ClaudeSessionLogProvider(tmp, { projectsRoot: tmp, offsetsFile: offsets });
seed.start(() => {});
seed.stop();

fs.appendFileSync(
  logFile,
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'bash-long', name: 'Bash', input: { command: 'npm test' } }] },
  }) + '\\n'
);

const progressLine =
  JSON.stringify({
    type: 'progress',
    parentToolUseID: 'bash-long',
    data: { type: 'bash_progress', output: '...' },
  }) + '\\n';

const events: import('${PROJECT_ROOT}/server/agentActivity/types.ts').AgentEvent[] = [];
const p = new ClaudeSessionLogProvider(tmp, { projectsRoot: tmp, offsetsFile: offsets, permissionTimerMs: 300 });
p.start((e) => events.push(e));
p.pollNow();

await new Promise<void>((resolve) => {
  const end = Date.now() + 1250;
  const timer = setInterval(() => {
    fs.appendFileSync(logFile, progressLine);
    p.pollNow();
    if (Date.now() >= end) {
      clearInterval(timer);
      resolve();
    }
  }, 50);
  fs.appendFileSync(logFile, progressLine);
  p.pollNow();
});

p.stop();
console.log(JSON.stringify({ perm: events.filter((e) => e.kind === 'permission').length }));
`
    );
    const out = JSON.parse(
      execFileSync(tsxBin, [runner], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim().split('\n').pop()
    );
    if (out.perm !== 0) throw new Error(`expected 0 permission events, got ${out.perm}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('second user text prompt emits userPrompt event', () => {
  const out = runEval(`
    import { parseClaudeJsonlLine } from '${PROJECT_ROOT}/server/agentActivity/claudeJsonlParser.ts';
    const state = { sessionStarted: true, hadToolsInTurn: false };
    const line = JSON.stringify({
      type: 'user',
      uuid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      message: { content: [{ type: 'text', text: 'follow-up question' }] },
    });
    const { events } = parseClaudeJsonlLine(line, { sessionId: 's', filePath: '/f', byteOffset: 1 }, state);
    console.log(JSON.stringify({ userPrompt: events.some((e) => e.kind === 'userPrompt') }));
  `);
  if (!out.userPrompt) throw new Error('expected userPrompt on later user message');
});

test('hook registry lock keeps parallel session registrations', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-lock-'));
  try {
    const runner = path.join(tmp, 'lock.mts');
    const tsx = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
    fs.writeFileSync(
      runner,
      `
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { hookSessionsPath } from '${PROJECT_ROOT}/server/agentActivity/hookDedupe.ts';

const root = ${JSON.stringify(tmp)};
const tsxBin = ${JSON.stringify(tsx)};
const ids = Array.from({ length: 30 }, (_, i) => 'sess-' + i);

await Promise.all(
  ids.map(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          tsxBin,
          [
            '--eval',
            \`import { registerHookSession } from '${PROJECT_ROOT}/server/agentActivity/hookDedupe.ts'; registerHookSession('\${root}', '\${id}');\`,
          ],
          { stdio: 'ignore' }
        );
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('exit ' + code))));
      })
  )
);

const reg = JSON.parse(fs.readFileSync(hookSessionsPath(root), 'utf-8'));
const missing = ids.filter((id) => !reg.sessions[id]);
console.log(JSON.stringify({ missing: missing.length }));
`
    );
    const out = JSON.parse(
      execFileSync(tsxBin, [runner], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim().split('\n').pop()
    );
    if (out.missing !== 0) throw new Error(`missing ${out.missing} sessions after parallel register`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`\n=== Mutation guards: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
