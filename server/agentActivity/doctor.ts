/**
 * Activity feed diagnostics (read-only).
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

const DASHBOARD_URLS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
]

export function runDoctor(projectRoot: string, _dashboardUrl?: string): DoctorReport {
  const lines: DoctorLine[] = [
    checkDashboardReachable(),
    checkClaudeHooks(projectRoot),
    checkClaudeSettingsJson(),
    checkSessionLogDirReadable(),
    checkSetAgentStatus(projectRoot),
    checkHookSessionsFile(projectRoot),
    checkStatusPython(projectRoot),
  ]
  return { lines }
}

function checkDashboardReachable(): DoctorLine {
  for (const base of DASHBOARD_URLS) {
    try {
      const res = spawnSync(
        'curl',
        ['-sf', '-o', '/dev/null', '-w', '%{http_code}', '-g', `${base}/live-status.json`],
        { encoding: 'utf-8', timeout: 5000 }
      )
      if (res.stdout?.trim() === '200') {
        return { ok: true, label: `Dashboard server reachable (${base})` }
      }
    } catch {
      /* try next */
    }
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
  const combined = `${res.stdout || ''}${res.stderr || ''}`
  if (res.status === 0) {
    return { ok: true, label: 'Claude Code hooks installed and current' }
  }
  if (combined.includes('outdated') || res.status === 1 && combined.includes('installed_version=1')) {
    return {
      ok: false,
      label: 'Claude hooks outdated (v1)',
      hint: 'Re-run ./scripts/install-claude-hooks.sh',
    }
  }
  if (combined.includes('outdated')) {
    return {
      ok: false,
      label: 'Claude hooks outdated',
      hint: 'Re-run ./scripts/install-claude-hooks.sh',
    }
  }
  return {
    ok: false,
    label: 'Claude Code hooks not installed',
    hint: './scripts/install-claude-hooks.sh',
  }
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
  const res = spawnSync(
    'python3',
    ['-B', '-c', `import ast; ast.parse(open(${JSON.stringify(p)}, encoding="utf-8").read())`],
    { encoding: 'utf-8' }
  )
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
