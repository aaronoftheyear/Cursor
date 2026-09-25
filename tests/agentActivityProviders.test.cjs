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

const script = `
  import { claudeHookToAgentEvent } from '${PROJECT_ROOT}/server/agentActivity/claudeHookBridge.ts';
  import { compareEventPriority } from '${PROJECT_ROOT}/server/agentActivity/activityFeed.ts';
  import { ClaudeSessionLogProvider } from '${PROJECT_ROOT}/server/agentActivity/providers/claudeSessionLogProvider.ts';
  const ev = claudeHookToAgentEvent({
    hook_event_name: 'PreToolUse',
    session_id: 's1',
    tool_name: 'Read',
    tool_input: { path: '/x.ts' },
    cwd: '/tmp',
  });
  if (!ev || ev.cursorEvent !== 'preToolUse') throw new Error('hook bridge');

  const hookPri = compareEventPriority(
    { id:'a', ts:0, source:'claude-hook', providerId:'', agentId:'', kind:'activity' },
    { id:'b', ts:0, source:'claude-session-log', providerId:'', agentId:'', kind:'activity' },
  );
  if (hookPri >= 0) throw new Error('hook should outrank log');

  const p = new ClaudeSessionLogProvider('${PROJECT_ROOT.replace(/'/g, "\\'")}', {
    projectsRoot: '/nonexistent-claude-projects',
  });
  if (p.id !== 'claude-session-log') throw new Error('provider id');
  console.log(JSON.stringify({ ok: true }));
`;

execFileSync(tsxBin, ['-e', script], { encoding: 'utf-8' });

test('claude hook bridge + provider interface', () => {
  // script throws on failure
});

console.log(`\n=== Providers: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
