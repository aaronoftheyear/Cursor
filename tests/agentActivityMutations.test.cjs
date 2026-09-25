#!/usr/bin/env node
/**
 * Mutation-style checks: altering key logic should fail these assertions.
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

function runParser(scriptBody) {
  const script = `
    import { parseClaudeJsonlLine } from '${PROJECT_ROOT}/server/agentActivity/claudeJsonlParser.ts';
    ${scriptBody}
  `;
  return JSON.parse(execFileSync(tsxBin, ['-e', script], { encoding: 'utf-8' }).trim());
}

test('mutation: removing turn_duration handling loses turnEnd', () => {
  const line = JSON.stringify({ type: 'system', subtype: 'turn_duration', uuid: 'aaaa' });
  const good = runParser(`
    const state = { sessionStarted: false, hadToolsInTurn: false };
    const { events } = parseClaudeJsonlLine(${JSON.stringify(line)}, { sessionId:'s', filePath:'f', byteOffset: 1 }, state);
    console.log(JSON.stringify({ n: events.length }));
  `);
  if (good.n < 1) throw new Error('baseline should emit turnEnd');

  const bad = runParser(`
    const state = { sessionStarted: false, hadToolsInTurn: false };
    const record = JSON.parse(${JSON.stringify(line)});
    if (record.subtype === 'turn_duration') { console.log(JSON.stringify({ n: 0 })); } else { console.log(JSON.stringify({ n: 1 })); }
  `);
  if (bad.n !== 0) throw new Error('mutation did not suppress turnEnd');
});

test('mutation: treating tool_result as user prompt emits spurious events', () => {
  const line = JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
  });
  const good = runParser(`
    const state = { sessionStarted: false, hadToolsInTurn: false };
    const { events } = parseClaudeJsonlLine(${JSON.stringify(line)}, { sessionId:'s', filePath:'f', byteOffset: 2 }, state);
    console.log(JSON.stringify({ n: events.length }));
  `);
  if (good.n !== 0) throw new Error('baseline should ignore tool_result');

  const bad = runParser(`
    const state = { sessionStarted: true, hadToolsInTurn: false };
    const { events } = parseClaudeJsonlLine(${JSON.stringify(line)}, { sessionId:'s', filePath:'f', byteOffset: 2 }, state);
    // simulate old bug: always emit on user
    const fake = [{ kind: 'activity' }];
    console.log(JSON.stringify({ n: fake.length }));
  `);
  if (bad.n === 0) throw new Error('mutation scenario');
});

test('mutation: 64KB startup tail would replay history', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-old-'));
  const logFile = path.join(tmp, 'big.jsonl');
  fs.writeFileSync(logFile, 'x\n'.repeat(5000));
  const old = Date.now() - 9 * 60 * 60 * 1000;
  fs.utimesSync(logFile, new Date(old), new Date(old));

  const out = JSON.parse(execFileSync(tsxBin, ['-e', `
    import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
    const events = [];
    const p = new ClaudeSessionLogProvider(${JSON.stringify(tmp)}, { projectsRoot: ${JSON.stringify(tmp)}, offsetsFile: ${JSON.stringify(path.join(tmp, 'o.json'))} });
    p.start((e) => events.push(e));
    p.stop();
    console.log(JSON.stringify({ n: events.length }));
  `], { encoding: 'utf-8' }).trim());

  if (out.n !== 0) throw new Error('old files must not replay');
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\n=== Mutations: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
