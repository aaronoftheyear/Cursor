/**
 * Activity feed diagnostics (pixtuoid doctor pattern — read-only checks).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { statusPythonPath } from './applyViaPython'
import { hookSessionsPath } from './hookDedupe'

export interface DoctorLine {
  ok: boolean
  label: string
  hint?: string
}

export interface DoctorReport {
  lines: DoctorLine[]
}

export const HOOK_VERSION_REQUIRED = 2

export function runDoctor(projectRoot: string, dashboardUrl = 'http://127.0.0.1:5173'): DoctorReport {
  const lines: DoctorLine[] = [
    checkDashboardReachable(dashboardUrl),
    checkClaudeHooks(projectRoot),
    checkClaudeSettingsJson(),
    checkSessionLogDirReadable(),
    checkSetAgentStatus(projectRoot),
    checkHookSessionsFile(projectRoot),
    checkStatusPython(projectRoot),
  ]
  return { lines }
}

function checkDashboardReachable(url: string): DoctorLine {
  try {
    const res = spawnSync(
      'curl',
      ['-sf', '-o', '/dev/null', '-w', '%{http_code}', `${url}/live-status.json`],
      { encoding: 'utf-8',
        timeout: 5000 }
    )
    const code = res.stdout?.trim()
    if (code === '200') return { ok: true, label: 'Dashboard server reachable' }
  } catch {
    /* fall through */
  }
  return {
    ok: false,
    label: 'Dashboard server not reachable',
    hint: 'Run npm run dev (or npm run electron:dev)',
  }
}

function checkClaudeHooks(projectRoot: string): DoctorLine {
  const script = path.join(projectRoot, 'scripts', 'install-claude-hooks.sh')
  const res = spawnSync('bash', [script, '--check'], { encoding: 'utf-8' })
  if (res.status !== 0) {
    return {
      ok: false,
      label: 'Claude Code hooks not installed',
      hint: './scripts/install-claude-hooks.sh',
    }
  }
  const settings = path.join(os.homedir(), '.claude', 'settings.json')
  const hookScript = path.join(projectRoot, '.cursor', 'hooks', 'claude-code-hook.cjs')
  try {
    const data = JSON.parse(fs.readFileSync(settings, 'utf-8')) as {
      hooks?: Record<string, unknown[]>
    }
    let foundVersion = 0
    let referencesOurHook = false
    for (const groups of Object.values(data.hooks || {})) {
      if (!Array.isArray(groups)) continue
      for (const group of groups) {
        if (!group || typeof group !== 'object') continue
        const g = group as Record<string, unknown>
        const hooks = g.hooks as Array<{ command?: string }> | undefined
        const ver = g._dashboard_hook_version
        if (hooks?.some((h) => (h.command || '').includes(hookScript))) {
          referencesOurHook = true
          if (typeof ver === 'number') foundVersion = Math.max(foundVersion, ver)
        }
      }
    }
    if (referencesOurHook && foundVersion < HOOK_VERSION_REQUIRED) {
      return {
        ok: false,
        label: `Claude hooks outdated (v${foundVersion || 0}, need v${HOOK_VERSION_REQUIRED})`,
        hint: 'Re-run ./scripts/install-claude-hooks.sh to upgrade the non-blocking hook',
      }
    }
  } catch {
    return {
      ok: false,
      label: 'Claude settings.json unreadable',
      hint: 'Fix ~/.claude/settings.json or re-run the hook installer',
    }
  }
  return { ok: true, label: 'Claude Code hooks installed and current' }
}

function checkClaudeSettingsJson(): DoctorLine {
  const settings = path.join(os.homedir(), '.claude', 'settings.json')
  if (!fs.existsSync(settings)) {
    return {
      ok: false,
      label: 'Claude settings.json missing',
      hint: 'Install Claude Code or run install-claude-hooks.sh',
    }
  }
  try {
    JSON.parse(fs.readFileSync(settings, 'utf-8'))
    return { ok: true, label: 'Claude settings.json valid JSON' }
  } catch {
    return {
      ok: false,
      label: 'Claude settings.json invalid',
      hint: 'Restore from a .backup file in ~/.claude/',
    }
  }
}

function checkSessionLogDirReadable(): DoctorLine {
  const dir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(dir)) {
    return {
      ok: false,
      label: 'Claude session-log directory missing',
      hint: `Expected ${dir} after using Claude Code`,
    }
  }
  try {
    fs.readdirSync(dir)
    return { ok: true, label: 'Claude session-log directory readable' }
  } catch {
    return {
      ok: false,
      label: 'Claude session-log directory not readable',
      hint: `Check permissions on ${dir}`,
    }
  }
}

function checkSetAgentStatus(projectRoot: string): DoctorLine {
  const script = path.join(projectRoot, 'scripts', 'set-agent-status.sh')
  if (!fs.existsSync(script)) {
    return { ok: false, label: 'set-agent-status.sh missing', hint: 'Re-clone the dashboard repo' }
  }
  const res = spawnSync('bash', [script, '-h'], { encoding: 'utf-8' })
  if (res.status !== 0) {
    return {
      ok: false,
      label: 'set-agent-status.sh failed',
      hint: 'Run bash scripts/set-agent-status.sh --help',
    }
  }
  return { ok: true, label: 'set-agent-status.sh executable' }
}

function checkHookSessionsFile(projectRoot: string): DoctorLine {
  const p = hookSessionsPath(projectRoot)
  if (!fs.existsSync(p)) {
    return {
      ok: true,
      label: 'Hook session registry (created on first Claude hook)',
    }
  }
  try {
    JSON.parse(fs.readFileSync(p, 'utf-8'))
    return { ok: true, label: 'Hook session registry readable' }
  } catch {
    return {
      ok: false,
      label: 'Hook session registry corrupt',
      hint: `Delete ${p} and re-run a Claude session`,
    }
  }
}

function checkStatusPython(projectRoot: string): DoctorLine {
  const p = statusPythonPath(projectRoot)
  if (!fs.existsSync(p)) {
    return { ok: false, label: 'update-dashboard-status.py missing' }
  }
  const res = spawnSync('python3', ['-m', 'py_compile', p], { encoding: 'utf-8' })
  if (res.status !== 0) {
    return { ok: false, label: 'update-dashboard-status.py has syntax errors' }
  }
  return { ok: true, label: 'Status Python hook script OK' }
}

export function formatDoctorReport(report: DoctorReport): string {
  return report.lines
    .map((l) => {
      const mark = l.ok ? '✓' : '✗'
      const hint = l.hint ? ` — ${l.hint}` : ''
      return `${mark} ${l.label}${hint}`
    })
    .join('\n')
}
