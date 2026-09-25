#!/usr/bin/env node
/**
 * Claude Code Dashboard Hook
 *
 * Receives Claude Code hook events and forwards them to the Dashboard's
 * existing status pipeline via update-dashboard-status.py.
 *
 * Claude Code events are translated to the Cursor event format:
 *   SessionStart → sessionStart
 *   UserPromptSubmit → beforeSubmitPrompt  
 *   PreToolUse → preToolUse
 *   PostToolUse → postToolUse
 *   Stop → stop
 *   SessionEnd → sessionEnd
 *
 * Tool names are mapped to activities the same way as Cursor hooks.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const STATUS_SCRIPT = path.join(__dirname, 'update-dashboard-status.py');

const CLAUDE_TO_CURSOR_EVENT = {
  SessionStart: 'sessionStart',
  UserPromptSubmit: 'beforeSubmitPrompt',
  PreToolUse: 'preToolUse',
  PostToolUse: 'postToolUse',
  Stop: 'stop',
  SessionEnd: 'sessionEnd',
  SubagentStop: 'stop',
  Notification: 'notification',
  PreCompact: 'beforeSubmitPrompt',
};

function translateClaudePayload(claudePayload) {
  const cursorPayload = {
    session_id: claudePayload.session_id,
    generation_id: `claude-${claudePayload.session_id}-${Date.now()}`,
    timestamp: Date.now(),
    workspace_roots: claudePayload.cwd ? [claudePayload.cwd] : [],
    source: 'claude-code',
  };

  if (claudePayload.tool_name) {
    cursorPayload.tool_name = claudePayload.tool_name.toLowerCase();
  }

  if (claudePayload.tool_input?.command) {
    cursorPayload.command = claudePayload.tool_input.command;
  }

  if (claudePayload.tool_input?.file_path || claudePayload.tool_input?.path) {
    cursorPayload.file_path = claudePayload.tool_input.file_path || claudePayload.tool_input.path;
  }

  if (claudePayload.prompt) {
    cursorPayload.prompt = claudePayload.prompt;
  }

  cursorPayload.agent_name = 'claude-code';
  cursorPayload.claude_code = true;

  return cursorPayload;
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    const timeout = setTimeout(() => resolve(data || '{}'), 2000);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timeout); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timeout); resolve('{}'); });
  });
}

async function main() {
  try {
    const raw = await readStdin();
    let claudePayload;
    try {
      claudePayload = JSON.parse(raw);
    } catch {
      process.exit(0);
    }

    const hookEventName = claudePayload.hook_event_name;
    if (!hookEventName) {
      process.exit(0);
    }

    const cursorEvent = CLAUDE_TO_CURSOR_EVENT[hookEventName];
    if (!cursorEvent) {
      process.exit(0);
    }

    const cursorPayload = translateClaudePayload(claudePayload);

    spawnSync('python3', [STATUS_SCRIPT, cursorEvent], {
      input: JSON.stringify(cursorPayload),
      encoding: 'utf-8',
      stdio: ['pipe', 'ignore', 'ignore'],
    });

    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main();
