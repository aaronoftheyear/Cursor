/**
 * Shared hook session registry (atomic write + 24h prune).
 * Used by claude-code-hook.cjs and server/agentActivity/hookDedupe.ts.
 */

const fs = require('fs');
const path = require('path');

const TTL_MS = 24 * 60 * 60 * 1000;

function hookSessionsPath(projectRoot) {
  return path.join(projectRoot, '.dashboard', 'hook-sessions.json');
}

function pruneSessions(sessions) {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, meta] of Object.entries(sessions)) {
    if (!meta || typeof meta.lastHookAt !== 'number' || meta.lastHookAt < cutoff) {
      delete sessions[id];
    }
  }
}

function loadRegistry(projectRoot) {
  const file = hookSessionsPath(projectRoot);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (data && typeof data === 'object' && data.sessions) return data;
  } catch {
    /* ignore */
  }
  return { sessions: {} };
}

function atomicWrite(file, text) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function registerHookSession(projectRoot, sessionId) {
  if (!sessionId) return;
  const file = hookSessionsPath(projectRoot);
  const reg = loadRegistry(projectRoot);
  reg.sessions[sessionId] = { lastHookAt: Date.now() };
  pruneSessions(reg.sessions);
  atomicWrite(file, JSON.stringify(reg, null, 2) + '\n');
}

module.exports = {
  TTL_MS,
  hookSessionsPath,
  pruneSessions,
  registerHookSession,
  loadRegistry,
};
