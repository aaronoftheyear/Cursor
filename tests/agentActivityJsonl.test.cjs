#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'claude-session', 'sample.jsonl');
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

const script = `
  import { parseClaudeJsonlLine, sessionIdFromJsonlPath } from '${PROJECT_ROOT}/server/agentActivity/claudeJsonlParser.ts';
  import fs from 'node:fs';

  const state = { sessionStarted: false, hadToolsInTurn: false };
  const fixture = '${FIXTURE.replace(/'/g, "\\'")}';
  const parent = sessionIdFromJsonlPath('/proj/demo-uuid/subagents/agent-a1b2.jsonl');
  if (parent !== 'demo-uuid') throw new Error('subagent parent session');

  const lines = fs.readFileSync(fixture, 'utf-8').trim().split('\\n');
  const all = [];
  let offset = 0;
  for (const line of lines) {
    const byteOffset = offset;
    offset += Buffer.byteLength(line, 'utf-8') + 1;
    const { events } = parseClaudeJsonlLine(line, {
      sessionId: 'demo-uuid',
      filePath: fixture,
      byteOffset,
    }, state);
    all.push(...events);
  }

  const ids = all.map(e => e.id);
  const unique = new Set(ids);
  if (ids.length !== unique.size) throw new Error('duplicate event ids');

  const kinds = all.map(e => e.kind + ':' + (e.activity || ''));
  const hasTurnEnd = kinds.some(k => k.startsWith('turnEnd'));
  const toolResultOnly = parseClaudeJsonlLine(lines[3], { sessionId:'s', filePath:'f', byteOffset:99 }, state);
  if (toolResultOnly.events.length !== 0) throw new Error('tool_result should not emit');

  const thinking = all.find(e => e.activity === 'thinking');
  if (!thinking) throw new Error('missing thinking');

  console.log(JSON.stringify({ count: all.length, hasTurnEnd, thinkingId: thinking.id }));
`;

const result = JSON.parse(execFileSync(tsxBin, ['-e', script], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim());

test('real-format fixture parses', () => {
  if (result.count < 4) throw new Error('too few events');
});

test('turn_duration emits turnEnd', () => {
  if (!result.hasTurnEnd) throw new Error('no turnEnd');
});

test('thinking uses thinking activity with stable uuid id', () => {
  if (!result.thinkingId.includes('11111111')) throw new Error('expected uuid in id');
});

console.log(`\n=== JSONL parser: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
