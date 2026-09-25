#!/usr/bin/env node

const path = require('path');
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
  const out = execFileSync(tsxBin, ['-e', scriptBody], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
  }).trim();
  return JSON.parse(out.split('\n').filter(Boolean).pop());
}

test('claude hook bridge maps PreToolUse', () => {
  const out = runEval(`
    import { claudeHookToAgentEvent } from '${PROJECT_ROOT}/server/agentActivity/claudeHookBridge.ts';
    const ev = claudeHookToAgentEvent({
      hook_event_name: 'PreToolUse',
      session_id: 's1',
      tool_name: 'Read',
      tool_input: { path: '/x.ts' },
      cwd: '/tmp',
    });
    console.log(JSON.stringify({ cursorEvent: ev?.cursorEvent }));
  `);
  if (out.cursorEvent !== 'preToolUse') throw new Error('hook bridge');
});

test('ClaudeSessionLogProvider exposes expected id', () => {
  const out = runEval(`
    import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
    const p = new ClaudeSessionLogProvider('${PROJECT_ROOT.replace(/'/g, "\\'")}', {
      projectsRoot: '/nonexistent-claude-projects',
    });
    console.log(JSON.stringify({ id: p.id }));
  `);
  if (out.id !== 'claude-session-log') throw new Error('provider id');
});

console.log(`\n=== Providers: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
