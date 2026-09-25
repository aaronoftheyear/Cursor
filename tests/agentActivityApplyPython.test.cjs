#!/usr/bin/env node

const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const tsxBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

const script = `
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
`;

execFileSync(tsxBin, ['-e', script], { encoding: 'utf-8' });
console.log('✓ missing python3 does not throw');
console.log('\n=== applyViaPython: 1 passed ===\n');
