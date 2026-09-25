/**
 * Apply hook-shaped events through the existing Python status pipeline.
 * Bounded concurrency + coalescing so log replay cannot fork thousands of processes.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentEvent } from './types'

const MAX_CONCURRENT = 2

export function statusPythonPath(projectRoot: string): string {
  return path.join(projectRoot, '.cursor', 'hooks', 'update-dashboard-status.py')
}

let running = 0
const pending: Array<{ projectRoot: string; event: AgentEvent; key: string }> = []
let loggedSpawnError = false

function coalesceKey(event: AgentEvent): string {
  return `${event.agentId}:${event.kind}:${event.activity || ''}:${event.cursorEvent || ''}`
}

function drainQueue(): void {
  while (running < MAX_CONCURRENT && pending.length > 0) {
    const job = pending.shift()!
    running++
    runOne(job.projectRoot, job.event, () => {
      running--
      drainQueue()
    })
  }
}

function runOne(
  projectRoot: string,
  event: AgentEvent,
  onDone: () => void
): void {
  if (!event.cursorEvent || !event.hookPayload) {
    onDone()
    return
  }
  const script = statusPythonPath(projectRoot)
  if (!fs.existsSync(script)) {
    onDone()
    return
  }

  const child = spawn('python3', [script, event.cursorEvent], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DASHBOARD_PROJECT_ROOT: projectRoot,
    },
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: false,
  })

  child.on('error', (err) => {
    if (!loggedSpawnError) {
      console.warn('[ActivityFeed] python3 spawn failed:', err.message)
      loggedSpawnError = true
    }
    onDone()
  })

  child.on('close', () => onDone())

  try {
    child.stdin.write(JSON.stringify(event.hookPayload))
    child.stdin.end()
  } catch {
    onDone()
  }
}

export function applyEventViaPython(projectRoot: string, event: AgentEvent): void {
  const key = coalesceKey(event)
  const existingIdx = pending.findIndex((j) => j.key === key)
  if (existingIdx >= 0) {
    pending[existingIdx] = { projectRoot, event, key }
  } else {
    pending.push({ projectRoot, event, key })
  }
  drainQueue()
}

/** Test helper */
export function resetPythonApplyQueue(): void {
  pending.length = 0
  running = 0
  loggedSpawnError = false
}
