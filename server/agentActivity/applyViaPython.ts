/**
 * Apply hook-shaped events through the existing Python status pipeline
 * so behaviour and tests stay identical.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentEvent } from './types'

export function statusPythonPath(projectRoot: string): string {
  return path.join(projectRoot, '.cursor', 'hooks', 'update-dashboard-status.py')
}

export function applyEventViaPython(
  projectRoot: string,
  event: AgentEvent
): void {
  if (!event.cursorEvent || !event.hookPayload) return
  const script = statusPythonPath(projectRoot)
  if (!fs.existsSync(script)) return

  const child = spawn('python3', [script, event.cursorEvent], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DASHBOARD_PROJECT_ROOT: projectRoot,
    },
    stdio: ['pipe', 'ignore', 'ignore'],
    detached: false,
  })
  child.stdin.write(JSON.stringify(event.hookPayload))
  child.stdin.end()
}
