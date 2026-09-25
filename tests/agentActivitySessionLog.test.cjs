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

function runProviderScenario(scriptBody) {
  const script = `
    import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
    ${scriptBody}
  `;
  const out = execFileSync(tsxBin, ['--eval', script], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim();
  const line = out.split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

function rmTmp(tmp) {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

test('startup does not replay old history', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clog-old-'));
  const logFile = path.join(tmp, 'old-session.jsonl');
  const history = Array.from({ length: 50 }, (_, i) =>
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: {} }] },
    })
  ).join('\n') + '\n';
  fs.writeFileSync(logFile, history);
  const twoHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  fs.utimesSync(logFile, new Date(twoHoursAgo), new Date(twoHoursAgo));

  const out = runProviderScenario(`
    const root = ${JSON.stringify(tmp)};
    const offsets = ${JSON.stringify(path.join(tmp, 'offsets.json'))};
    const events = [];
    const p = new ClaudeSessionLogProvider(root, { projectsRoot: root, offsetsFile: offsets });
    p.start((e) => events.push(e));
    p.stop();
    console.log(JSON.stringify({ count: events.length }));
  `);
  if (out.count !== 0) throw new Error(`expected 0 events, got ${out.count}`);
  rmTmp(tmp);
});

test('only newly appended lines emit events', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clog-append2-'));
  const logFile = path.join(tmp, 'live.jsonl');
  fs.writeFileSync(logFile, '\n');
  const offsets = path.join(tmp, 'offsets.json');
  const record = {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'x1', name: 'Read', input: { file_path: '/a' } }] },
    uuid: '33333333-3333-4333-8333-333333333333',
  };

  const out = runProviderScenario(`
    import fs from 'node:fs';
    const root = ${JSON.stringify(tmp)};
    const logFile = ${JSON.stringify(logFile)};
    const offsets = ${JSON.stringify(offsets)};
    const events = [];
    const p = new ClaudeSessionLogProvider(root, { projectsRoot: root, offsetsFile: offsets });
    p.start(() => {});
    p.stop();
    fs.appendFileSync(logFile, ${JSON.stringify(JSON.stringify(record))} + '\\n');
    const p2 = new ClaudeSessionLogProvider(root, { projectsRoot: root, offsetsFile: offsets });
    p2.start((e) => events.push(e));
    p2.stop();
    console.log(JSON.stringify({ count: events.length, act: events.find(e => e.activity === 'reading')?.activity }));
  `);
  if (out.count < 1) throw new Error('expected events on append');
  if (out.act !== 'reading') throw new Error(`expected reading got ${out.act}`);
  rmTmp(tmp);
});

test('file truncation resets offset and partial line buffer', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clog-rot-'));
  const logFile = path.join(tmp, 'rot.jsonl');
  fs.writeFileSync(logFile, '{"type":"user","message":{"content":"hel');
  const offsets = path.join(tmp, 'offsets.json');

  const out = runProviderScenario(`
    import fs from 'node:fs';
    const root = ${JSON.stringify(tmp)};
    const logFile = ${JSON.stringify(logFile)};
    const offsets = ${JSON.stringify(offsets)};
    const events = [];
    const p = new ClaudeSessionLogProvider(root, { projectsRoot: root, offsetsFile: offsets });
    p.start((e) => events.push(e));
    p.stop();
    fs.writeFileSync(logFile, '');
    const line = JSON.stringify({ type: 'system', subtype: 'turn_duration', uuid: '44444444-4444-4444-8444-444444444444' });
    fs.appendFileSync(logFile, line + '\\n');
    fs.utimesSync(logFile, new Date(), new Date());
    const p2 = new ClaudeSessionLogProvider(root, { projectsRoot: root, offsetsFile: offsets });
    p2.start((e) => events.push(e));
    p2.stop();
    console.log(JSON.stringify({ turnEnd: events.some(e => e.kind === 'turnEnd') }));
  `);
  if (!out.turnEnd) throw new Error('expected turnEnd after rotation');
  rmTmp(tmp);
});

test('permission timer fires for non-exempt tool', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clog-perm-'));
  const logFile = path.join(tmp, 'perm.jsonl');
  const offsets = path.join(tmp, 'offsets.json');
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'bash1', name: 'Bash', input: { command: 'npm test' } }] },
    uuid: '55555555-5555-4555-8555-555555555555',
  });
  fs.writeFileSync(logFile, '');
  fs.utimesSync(logFile, new Date(), new Date());
  const seed = runProviderScenario(`
    const root = ${JSON.stringify(tmp)};
    const offsets = ${JSON.stringify(offsets)};
    const p = new ClaudeSessionLogProvider(root, { projectsRoot: root, offsetsFile: offsets });
    p.start(() => {});
    p.stop();
    console.log(JSON.stringify({ ok: true }));
  `);
  if (!seed.ok) throw new Error('seed failed');
  fs.appendFileSync(logFile, line + '\n');

  const runner = path.join(tmp, 'perm-runner.mts');
  fs.writeFileSync(
    runner,
    `
import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
const root = ${JSON.stringify(tmp)};
const offsets = ${JSON.stringify(offsets)};
const events: import('${PROJECT_ROOT}/server/agentActivity/types.ts').AgentEvent[] = [];
await new Promise<void>((resolve) => {
  const p = new ClaudeSessionLogProvider(root, { projectsRoot: root, offsetsFile: offsets, permissionTimerMs: 40 });
  p.start((e) => events.push(e));
  setTimeout(() => { p.stop(); resolve(); }, 120);
});
console.log(JSON.stringify({ perm: events.some((e) => e.kind === 'permission') }));
`
  );
  const out = JSON.parse(
    execFileSync(tsxBin, [runner], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim().split('\n').pop()
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!out.perm) throw new Error('permission timer did not fire');
});

console.log(`\n=== Session log provider: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
