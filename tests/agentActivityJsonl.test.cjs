#!/usr/bin/env node
/**
 * Unit tests for Claude session JSONL parsing (fixture data only).
 */

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

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}. ${msg}`);
  }
}

const script = `
  import { parseClaudeJsonlLine, sessionIdFromJsonlPath } from '${PROJECT_ROOT}/server/agentActivity/claudeJsonlParser.ts';
  import fs from 'node:fs';

  const fixture = '${FIXTURE.replace(/'/g, "\\'")}';
  const sessionId = sessionIdFromJsonlPath('/home/user/.claude/projects/demo-workspace/abc-123.jsonl');
  if (sessionId !== 'abc-123') throw new Error('session id from path');

  const lines = fs.readFileSync(fixture, 'utf-8').trim().split('\\n');
  const all = [];
  lines.forEach((line, i) => {
    all.push(...parseClaudeJsonlLine(line, { sessionId: 'fixture-session-001', filePath: fixture, lineIndex: i }));
  });

  const kinds = all.map(e => e.kind + ':' + (e.activity || ''));
  console.log(JSON.stringify({ count: all.length, kinds, first: all[0]?.kind }));
`;

const out = execFileSync(tsxBin, ['-e', script], { encoding: 'utf-8', cwd: PROJECT_ROOT });
const result = JSON.parse(out.trim());

test('fixture jsonl parses without error', () => {
  assertEqual(typeof result.count, 'number');
  assertEqual(result.count >= 6, true);
});

test('sessionStart from system init', () => {
  assertEqual(result.first, 'sessionStart');
});

test('fixture contains reading/editing/running/github/researching', () => {
  const blob = result.kinds.join(',');
  assertEqual(blob.includes('activity:reading'), true);
  assertEqual(blob.includes('activity:editing'), true);
  assertEqual(blob.includes('activity:running'), true);
  assertEqual(blob.includes('activity:github'), true);
  assertEqual(blob.includes('activity:researching'), true);
});

console.log(`\n=== JSONL parser: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
