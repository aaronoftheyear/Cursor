/**
 * When Claude hooks are active for a session, session-log fallback must stand down.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import type { AgentEvent } from './types'

const require = createRequire(import.meta.url)
const registryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.cursor/hooks/hook-sessions-registry.cjs'
)
const registry = require(registryPath) as {
  hookSessionsPath: (projectRoot: string) => string
  registerHookSession: (projectRoot: string, sessionId: string) => void
  loadRegistry: (projectRoot: string) => { sessions: Record<string, { lastHookAt: number }> }
  TTL_MS: number
}

export const HOOK_SESSION_TTL_MS = registry.TTL_MS

export function hookSessionsPath(projectRoot: string): string {
  return registry.hookSessionsPath(projectRoot)
}

export function registerHookSession(projectRoot: string, sessionId: string): void {
  registry.registerHookSession(projectRoot, sessionId)
}

export function isHookOwnedSession(projectRoot: string, sessionId: string | undefined): boolean {
  if (!sessionId) return false
  const reg = registry.loadRegistry(projectRoot)
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
