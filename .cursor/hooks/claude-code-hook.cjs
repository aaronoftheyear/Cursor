#!/usr/bin/env node
/**
 * Claude Code Dashboard Hook — non-blocking forward to update-dashboard-status.py
 *
 * @dashboard_hook_version 2 (also passed as --dashboard-hook-version=2 in settings)
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { registerHookSession } = require('./hook-sessions-registry.cjs');

const HOOK_VERSION = 2;
const STATUS_SCRIPT = path.join(__dirname, 'update-dashboard-status.py');

const CLAUDE_TO_CURSOR_EVENT = {
  SessionStart: 'sessionStart',
  UserPromptSubmit: 'beforeSubmitPrompt',
  PreToolUse: 'preToolUse',
  PostToolUse: 'postToolUse',
  Stop: 'stop',
  SessionEnd: 'sessionEnd',
};

const IGNORED_EVENTS = new Set([
  'SubagentStop',
  'Notification',
  'PreCompact',
]);

function resolveProjectRoot() {
  if (process.env.DASHBOARD_PROJECT_ROOT) {
    return process.env.DASHBOARD_PROJECT_ROOT;
  }
  return path.resolve(__dirname, '..', '..');
}

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

function forwardDetached(cursorEvent, cursorPayload, projectRoot) {
  const payloadJson = JSON.stringify(cursorPayload);
  try {
    const child = spawn('python3', [STATUS_SCRIPT, cursorEvent], {
      cwd: projectRoot,
      env: { ...process.env, DASHBOARD_PROJECT_ROOT: projectRoot },
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.stdin.write(payloadJson);
    child.stdin.end();
    child.unref();
  } catch {
    /* ignore */
  }
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

    if (IGNORED_EVENTS.has(hookEventName)) {
      process.exit(0);
    }

    const cursorEvent = CLAUDE_TO_CURSOR_EVENT[hookEventName];
    if (!cursorEvent) {
      process.exit(0);
    }

    const projectRoot = resolveProjectRoot();
    const cursorPayload = translateClaudePayload(claudePayload);
    registerHookSession(projectRoot, cursorPayload.session_id);

    if (process.env.DASHBOARD_HOOK_SYNC === '1') {
      spawnSync('python3', [STATUS_SCRIPT, cursorEvent], {
        cwd: projectRoot,
        env: { ...process.env, DASHBOARD_PROJECT_ROOT: projectRoot },
        input: JSON.stringify(cursorPayload),
        encoding: 'utf-8',
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    } else {
      forwardDetached(cursorEvent, cursorPayload, projectRoot);
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main();

module.exports = { HOOK_VERSION, translateClaudePayload, forwardDetached };
