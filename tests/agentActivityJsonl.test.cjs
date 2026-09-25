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

function loadParseResult() {
  const script = `
    import { parseClaudeJsonlLine, sessionIdFromJsonlPath } from '${PROJECT_ROOT}/server/agentActivity/claudeJsonlParser.ts';
    import fs from 'node:fs';

    const state = { sessionStarted: false, hadToolsInTurn: false };
    const fixture = '${FIXTURE.replace(/'/g, "\\'")}';
    const parent = sessionIdFromJsonlPath('/proj/demo-uuid/subagents/agent-a1b2.jsonl');

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
    const kinds = all.map(e => e.kind + ':' + (e.activity || ''));
    const hasTurnEnd = kinds.some(k => k.startsWith('turnEnd'));
    const toolResultOnly = parseClaudeJsonlLine(lines[3], { sessionId:'s', filePath:'f', byteOffset:99 }, state);
    const thinking = all.find(e => e.activity === 'thinking');
    const thinkingOnly = parseClaudeJsonlLine(lines[1], { sessionId:'demo', filePath:'f', byteOffset: 50 }, { sessionStarted: true, hadToolsInTurn: false });

    console.log(JSON.stringify({
      parent,
      uniqueIds: ids.length === unique.size,
      count: all.length,
      hasTurnEnd,
      toolResultEvents: toolResultOnly.events.length,
      thinkingId: thinking?.id,
      thinkingOnlyCount: thinkingOnly.events.length,
    }));
  `;
  const out = execFileSync(tsxBin, ['-e', script], { encoding: 'utf-8', cwd: PROJECT_ROOT }).trim();
  return JSON.parse(out.split('\n').filter(Boolean).pop());
}

const result = loadParseResult();

test('subagent jsonl maps to parent session id', () => {
  if (result.parent !== 'demo-uuid') throw new Error(`expected demo-uuid, got ${result.parent}`);
});

test('real-format fixture parses with unique ids', () => {
  if (!result.uniqueIds) throw new Error('duplicate event ids');
  if (result.count < 4) throw new Error('too few events');
});

test('turn_duration emits turnEnd', () => {
  if (!result.hasTurnEnd) throw new Error('no turnEnd');
});

test('thinking blocks emit thinking activity with stable uuid id', () => {
  if (!result.thinkingId || !result.thinkingId.includes('11111111')) {
    throw new Error('expected uuid in thinking id');
  }
});

test('thinking-only assistant line still emits when session already started', () => {
  if (result.thinkingOnlyCount < 1) throw new Error('thinking block should not be ignored');
});

test('tool_result user line does not emit events', () => {
  if (result.toolResultEvents !== 0) throw new Error('tool_result should not emit');
});

console.log(`\n=== JSONL parser: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
