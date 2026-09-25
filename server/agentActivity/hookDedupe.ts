/**
 * When Claude hooks are active for a session, session-log fallback must stand down.
 * Hooks register sessions via .dashboard/hook-sessions.json (written by claude-code-hook.cjs).
 */

import fs from 'node:fs'
import path from 'node:path'
import type { AgentEvent } from './types'

export interface HookSessionRegistry {
  sessions: Record<string, { lastHookAt: number }>
}

export function hookSessionsPath(projectRoot: string): string {
  return path.join(projectRoot, '.dashboard', 'hook-sessions.json')
}

export function loadHookSessions(projectRoot: string): HookSessionRegistry {
  const file = hookSessionsPath(projectRoot)
  try {
    if (!fs.existsSync(file)) return { sessions: {} }
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as HookSessionRegistry
    if (data && typeof data === 'object' && data.sessions) return data
  } catch {
    /* ignore */
  }
  return { sessions: {} }
}

export function registerHookSession(projectRoot: string, sessionId: string): void {
  if (!sessionId) return
  const file = hookSessionsPath(projectRoot)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const reg = loadHookSessions(projectRoot)
  reg.sessions[sessionId] = { lastHookAt: Date.now() }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [id, meta] of Object.entries(reg.sessions)) {
    if (meta.lastHookAt < cutoff) delete reg.sessions[id]
  }
  fs.writeFileSync(file, JSON.stringify(reg, null, 2) + '\n')
}

/** True when hooks own this session — log fallback should not apply. */
export function isHookOwnedSession(projectRoot: string, sessionId: string | undefined): boolean {
  if (!sessionId) return false
  const reg = loadHookSessions(projectRoot)
  return sessionId in reg.sessions
}

export function shouldApplyLogFallbackEvent(
  projectRoot: string,
  event: AgentEvent
): boolean {
  if (event.source !== 'claude-session-log') return true
  if (!event.sessionId) return true
  return !isHookOwnedSession(projectRoot, event.sessionId)
}
