/**
 * Shared hook session registry (atomic write + 24h prune).
 * Used by claude-code-hook.cjs and server/agentActivity/hookDedupe.ts.
 */

const fs = require('fs');
const path = require('path');
const TTL_MS = 24 * 60 * 60 * 1000;
const LOCK_MAX_ATTEMPTS = 12;
const LOCK_STALE_MS = 5000;

function hookSessionsPath(projectRoot) {
  return path.join(projectRoot, '.dashboard', 'hook-sessions.json');
}

function lockPath(projectRoot) {
  return path.join(projectRoot, '.dashboard', 'hook-sessions.lock');
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

function acquireLock(projectRoot) {
  const lock = lockPath(projectRoot);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(lock);
        } catch {
          /* ignore */
        }
      };
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        try {
          const st = fs.statSync(lock);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock);
        } catch {
          /* ignore */
        }
        continue;
      }
    }
  }
  return null;
}

function registerHookSession(projectRoot, sessionId) {
  if (!sessionId) return;
  const file = hookSessionsPath(projectRoot);
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    const release = acquireLock(projectRoot);
    if (!release) continue;
    try {
      const reg = loadRegistry(projectRoot);
      reg.sessions[sessionId] = { lastHookAt: Date.now() };
      pruneSessions(reg.sessions);
      atomicWrite(file, JSON.stringify(reg, null, 2) + '\n');
      return;
    } finally {
      release();
    }
  }
}

module.exports = {
  TTL_MS,
  hookSessionsPath,
  pruneSessions,
  registerHookSession,
  loadRegistry,
};
