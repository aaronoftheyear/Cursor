#!/usr/bin/env node
/**
 * Regression tests that execute real parser/provider code (must fail on pre-fix bugs).
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
  const script = `${scriptBody}`;
  const out = execFileSync(tsxBin, ['--eval', script], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim();
  const line = out.split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

test('two tool_use blocks in one assistant record emit two events', () => {
  const out = runEval(`
    import { parseClaudeJsonlLine } from '${PROJECT_ROOT}/server/agentActivity/claudeJsonlParser.ts';
    const line = JSON.stringify({
      type: 'assistant',
      uuid: '77777777-7777-4777-8777-777777777777',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-a', name: 'Read', input: {} },
          { type: 'tool_use', id: 'tool-b', name: 'Grep', input: {} },
        ],
      },
    });
    const state = { sessionStarted: false, hadToolsInTurn: false };
    const { events } = parseClaudeJsonlLine(line, { sessionId: 'sess', filePath: '/f.jsonl', byteOffset: 10 }, state);
    const toolEvents = events.filter((e) => e.kind === 'activity');
    console.log(JSON.stringify({ n: toolEvents.length, ids: toolEvents.map((e) => e.id) }));
  `);
  if (out.n !== 2) throw new Error(`expected 2 tool events, got ${out.n}`);
  if (new Set(out.ids).size !== 2) throw new Error('event ids must be unique per tool');
});

test('user prompt with text array blocks is recognized', () => {
  const out = runEval(`
    import { parseClaudeJsonlLine } from '${PROJECT_ROOT}/server/agentActivity/claudeJsonlParser.ts';
    const line = JSON.stringify({
      type: 'user',
      uuid: '88888888-8888-4888-8888-888888888888',
      message: { content: [{ type: 'text', text: 'hello dashboard' }] },
    });
    const state = { sessionStarted: false, hadToolsInTurn: false };
    const { events } = parseClaudeJsonlLine(line, { sessionId: 'sess', filePath: '/f.jsonl', byteOffset: 20 }, state);
    console.log(JSON.stringify({
      sessionStart: events.some((e) => e.kind === 'sessionStart'),
      userPrompt: events.some((e) => e.kind === 'userPrompt'),
    }));
  `);
  if (!out.sessionStart) throw new Error('expected sessionStart from text array user prompt');
  if (!out.userPrompt) throw new Error('expected userPrompt from text array user prompt');
});

test('idle double poll on seeded file emits zero events', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-idle-'));
  try {
    const logFile = path.join(tmp, 'idle.jsonl');
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] } }),
      JSON.stringify({ type: 'system', subtype: 'turn_duration' }),
      JSON.stringify({ type: 'user', message: { content: 'done' } }),
    ].join('\n') + '\n';
    fs.writeFileSync(logFile, lines);
    const old = Date.now() - 3 * 60 * 60 * 1000;
    fs.utimesSync(logFile, new Date(old), new Date(old));
    const offsets = path.join(tmp, 'offsets.json');

    const out = runEval(`
      import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
      const root = ${JSON.stringify(tmp)};
      const offsets = ${JSON.stringify(offsets)};
      const events = [];
      const p = new ClaudeSessionLogProvider(root, { projectsRoot: root, offsetsFile: offsets });
      p.start((e) => events.push(e));
      p.pollNow();
      p.pollNow();
      p.stop();
      console.log(JSON.stringify({ count: events.length }));
    `);
    if (out.count !== 0) throw new Error(`expected 0 events on idle polls, got ${out.count}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('recent file at first sight starts at EOF with zero events', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-recent-'));
  try {
    const logFile = path.join(tmp, 'fresh.jsonl');
    fs.writeFileSync(
      logFile,
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'echo hi' } }] },
      }) + '\n'
    );
    fs.utimesSync(logFile, new Date(), new Date());
    const offsets = path.join(tmp, 'offsets.json');

    const out = runEval(`
      import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
      const events = [];
      const p = new ClaudeSessionLogProvider(${JSON.stringify(tmp)}, {
        projectsRoot: ${JSON.stringify(tmp)},
        offsetsFile: ${JSON.stringify(offsets)},
      });
      p.start((e) => events.push(e));
      p.stop();
      console.log(JSON.stringify({ count: events.length }));
    `);
    if (out.count !== 0) throw new Error(`recent file must not replay, got ${out.count}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('half-written line on same provider instance emits exactly one turnEnd', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-half-'));
  try {
    const logFile = path.join(tmp, 'half.jsonl');
    const fullLine = JSON.stringify({
      type: 'system',
      subtype: 'turn_duration',
      uuid: '99999999-9999-4999-8999-999999999999',
    });
    fs.writeFileSync(logFile, '');
    fs.utimesSync(logFile, new Date(), new Date());
    const offsets = path.join(tmp, 'offsets.json');

    runEval(`
      import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
      const p = new ClaudeSessionLogProvider(${JSON.stringify(tmp)}, {
        projectsRoot: ${JSON.stringify(tmp)},
        offsetsFile: ${JSON.stringify(offsets)},
      });
      p.start(() => {});
      p.stop();
      console.log(JSON.stringify({ ok: true }));
    `);

    const runner = path.join(tmp, 'half-runner.mts');
    fs.writeFileSync(
      runner,
      `
import fs from 'node:fs';
import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';

const logFile = ${JSON.stringify(logFile)};
const fullLine = ${JSON.stringify(fullLine)};
const events: import('${PROJECT_ROOT}/server/agentActivity/types.ts').AgentEvent[] = [];
const p = new ClaudeSessionLogProvider(${JSON.stringify(tmp)}, {
  projectsRoot: ${JSON.stringify(tmp)},
  offsetsFile: ${JSON.stringify(offsets)},
});
p.start((e) => events.push(e));

const partial = fullLine.slice(0, 24);
fs.appendFileSync(logFile, partial);
p.pollNow();
const afterPartial = events.length;

fs.appendFileSync(logFile, fullLine.slice(24) + '\\n');
p.pollNow();
const turnEnds = events.filter((e) => e.kind === 'turnEnd').length;
p.stop();
console.log(JSON.stringify({ afterPartial, turnEnds, total: events.length }));
`
    );

    const out = JSON.parse(
      execFileSync(tsxBin, [runner], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim().split('\n').pop()
    );
    if (out.afterPartial !== 0) throw new Error(`partial poll expected 0 events, got ${out.afterPartial}`);
    if (out.turnEnds !== 1) throw new Error(`expected 1 turnEnd, got ${out.turnEnds}`);
    if (out.total !== 1) throw new Error(`expected exactly 1 event total, got ${out.total}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('bash_progress records refresh permission timer (no false permission wait)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-progress-'));
  try {
    const logFile = path.join(tmp, 'prog.jsonl');
    const offsets = path.join(tmp, 'offsets.json');
    fs.writeFileSync(logFile, '');
    fs.utimesSync(logFile, new Date(), new Date());

    runEval(`
      import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
      const p = new ClaudeSessionLogProvider(${JSON.stringify(tmp)}, {
        projectsRoot: ${JSON.stringify(tmp)},
        offsetsFile: ${JSON.stringify(offsets)},
      });
      p.start(() => {});
      p.stop();
      console.log(JSON.stringify({ ok: true }));
    `);

    const bashLine = JSON.stringify({
      type: 'assistant',
      uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      message: {
        content: [{ type: 'tool_use', id: 'bash-long', name: 'Bash', input: { command: 'npm test' } }],
      },
    });
    fs.appendFileSync(logFile, bashLine + '\n');

    const progressJson = JSON.stringify({
      type: 'progress',
      parentToolUseID: 'bash-long',
      data: { type: 'bash_progress', output: 'running...' },
    });

    const runner = path.join(tmp, 'prog-runner.mts');
    fs.writeFileSync(
      runner,
      `
import fs from 'node:fs';
import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';

const logFile = ${JSON.stringify(logFile)};
const progressLine = ${JSON.stringify(progressJson + '\\n')};
const events: import('${PROJECT_ROOT}/server/agentActivity/types.ts').AgentEvent[] = [];
const p = new ClaudeSessionLogProvider(${JSON.stringify(tmp)}, {
  projectsRoot: ${JSON.stringify(tmp)},
  offsetsFile: ${JSON.stringify(offsets)},
  permissionTimerMs: 5000,
});
p.start((e) => events.push(e));
p.pollNow();

for (let i = 0; i < 8; i++) {
  fs.appendFileSync(logFile, progressLine);
  p.pollNow();
}

await new Promise((r) => setTimeout(r, 250));
p.stop();
const perm = events.filter((e) => e.kind === 'permission').length;
console.log(JSON.stringify({ perm }));
`
    );

    const out = JSON.parse(
      execFileSync(tsxBin, [runner], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim().split('\n').pop()
    );
    if (out.perm !== 0) throw new Error(`expected no permission event, got ${out.perm}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('tool_result cancels permission timer before it fires', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-cancel-'));
  try {
    const logFile = path.join(tmp, 'cancel.jsonl');
    const offsets = path.join(tmp, 'offsets.json');
    fs.writeFileSync(logFile, '');
    fs.utimesSync(logFile, new Date(), new Date());

    runEval(`
      import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
      const p = new ClaudeSessionLogProvider(${JSON.stringify(tmp)}, {
        projectsRoot: ${JSON.stringify(tmp)},
        offsetsFile: ${JSON.stringify(offsets)},
      });
      p.start(() => {});
      p.stop();
      console.log(JSON.stringify({ ok: true }));
    `);

    const bashLine =
      JSON.stringify({
        type: 'assistant',
        uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        message: { content: [{ type: 'tool_use', id: 'bash1', name: 'Bash', input: { command: 'sleep 1' } }] },
      }) + '\n';
    const resultLine =
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'bash1', content: 'ok' }] },
      }) + '\n';
    fs.appendFileSync(logFile, bashLine);
    fs.appendFileSync(logFile, resultLine);

    const runner = path.join(tmp, 'cancel-runner.mts');
    fs.writeFileSync(
      runner,
      `
import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
const events: import('${PROJECT_ROOT}/server/agentActivity/types.ts').AgentEvent[] = [];
await new Promise<void>((resolve) => {
  const p = new ClaudeSessionLogProvider(${JSON.stringify(tmp)}, {
    projectsRoot: ${JSON.stringify(tmp)},
    offsetsFile: ${JSON.stringify(offsets)},
    permissionTimerMs: 200,
  });
  p.start((e) => events.push(e));
  setTimeout(() => { p.stop(); resolve(); }, 350);
});
console.log(JSON.stringify({ perm: events.filter((e) => e.kind === 'permission').length }));
`
    );
    const out = JSON.parse(
      execFileSync(tsxBin, [runner], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim().split('\n').pop()
    );
    if (out.perm !== 0) throw new Error(`permission should be cancelled, got ${out.perm}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`\n=== Mutations: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
