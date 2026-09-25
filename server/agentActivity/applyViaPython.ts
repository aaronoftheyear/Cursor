/**
 * Apply hook-shaped events through the existing Python status pipeline.
 * Per-agent serialization preserves order; global cap limits total concurrency.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentEvent } from './types'

const MAX_CONCURRENT = 2

export function statusPythonPath(projectRoot: string): string {
  return path.join(projectRoot, '.cursor', 'hooks', 'update-dashboard-status.py')
}

type Job = { projectRoot: string; event: AgentEvent; key: string }

let globalRunning = 0
const perAgentQueue = new Map<string, Job[]>()
const perAgentRunning = new Set<string>()
let loggedSpawnError = false

function coalesceKey(event: AgentEvent): string {
  return `${event.kind}:${event.activity || ''}:${event.cursorEvent || ''}`
}

function drainQueue(): void {
  while (globalRunning < MAX_CONCURRENT) {
    let started = false
    for (const [agentId, queue] of perAgentQueue) {
      if (!queue.length || perAgentRunning.has(agentId)) continue
      const job = queue.shift()!
      if (!queue.length) perAgentQueue.delete(agentId)
      perAgentRunning.add(agentId)
      globalRunning++
      runOne(job.projectRoot, job.event, () => {
        perAgentRunning.delete(agentId)
        globalRunning--
        drainQueue()
      })
      started = true
      break
    }
    if (!started) break
  }
}

function runOne(
  projectRoot: string,
  event: AgentEvent,
  onDone: () => void
): void {
  let finished = false
  const done = () => {
    if (finished) return
    finished = true
    onDone()
  }

  if (!event.cursorEvent || !event.hookPayload) {
    done()
    return
  }
  const script = statusPythonPath(projectRoot)
  if (!fs.existsSync(script)) {
    done()
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
    done()
  })

  child.on('close', () => done())

  try {
    child.stdin.write(JSON.stringify(event.hookPayload))
    child.stdin.end()
  } catch {
    done()
  }
}

export function applyEventViaPython(projectRoot: string, event: AgentEvent): void {
  const agentId = event.agentId || 'default'
  const key = coalesceKey(event)
  const queue = perAgentQueue.get(agentId) || []
  const existingIdx = queue.findIndex((j) => j.key === key)
  if (existingIdx >= 0) {
    queue[existingIdx] = { projectRoot, event, key }
  } else {
    queue.push({ projectRoot, event, key })
  }
  perAgentQueue.set(agentId, queue)
  drainQueue()
}

/** Test helper */
export function resetPythonApplyQueue(): void {
  perAgentQueue.clear()
  perAgentRunning.clear()
  globalRunning = 0
  loggedSpawnError = false
}

/** Test helper: wait until queue is idle */
export function waitForPythonApplyIdle(): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (globalRunning === 0 && perAgentQueue.size === 0) resolve()
      else setTimeout(tick, 10)
    }
    tick()
  })
}
