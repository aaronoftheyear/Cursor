/**
 * Claude session JSONL fallback — tails ~/.claude/projects (pixel-agents, MIT).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  type ClaudeJsonlSessionState,
  parseClaudeJsonlLine,
  sessionIdFromJsonlPath,
} from '../claudeJsonlParser'
import type { AgentActivityProvider, AgentEvent } from '../types'

const POLL_MS = 500
const RECENT_FILE_MS = 120_000
const PERMISSION_TIMER_MS = 7_000

export interface ClaudeSessionLogOptions {
  projectsRoot?: string
  offsetsFile?: string
  permissionTimerMs?: number
}

export function defaultOffsetsPath(): string {
  return path.join(
    os.homedir(),
    '.cache',
    'ai-agent-dashboard',
    'claude-jsonl-offsets.json'
  )
}

export class ClaudeSessionLogProvider implements AgentActivityProvider {
  readonly id = 'claude-session-log'
  private timer: ReturnType<typeof setInterval> | null = null
  private emit: ((e: AgentEvent) => void) | null = null
  private offsets = new Map<string, { offset: number; lastSize: number }>()
  private sessionState = new Map<string, ClaudeJsonlSessionState>()
  private permissionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private offsetsDirty = false
  private readonly projectsRoot: string
  private readonly offsetsFile: string
  private readonly permissionTimerMs: number
  private knownFiles = new Set<string>()

  constructor(_projectRoot: string, options: ClaudeSessionLogOptions = {}) {
    this.projectsRoot =
      options.projectsRoot ?? path.join(os.homedir(), '.claude', 'projects')
    this.offsetsFile = options.offsetsFile ?? defaultOffsetsPath()
    this.permissionTimerMs = options.permissionTimerMs ?? PERMISSION_TIMER_MS
  }

  isPolling(): boolean {
    return this.timer !== null
  }

  /** Test helper: one poll cycle without waiting for the interval. */
  pollNow(): void {
    this.poll()
  }

  private loadOffsets(): void {
    try {
      if (!fs.existsSync(this.offsetsFile)) return
      const data = JSON.parse(fs.readFileSync(this.offsetsFile, 'utf-8')) as Record<
        string,
        number | { offset: number; lastSize?: number }
      >
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'number') this.offsets.set(k, { offset: v, lastSize: v })
        else if (v && typeof v === 'object' && typeof v.offset === 'number') {
          this.offsets.set(k, { offset: v.offset, lastSize: v.lastSize ?? v.offset })
        }
      }
    } catch {
      /* ignore */
    }
  }

  private saveOffsetsIfDirty(): void {
    if (!this.offsetsDirty) return
    const dir = path.dirname(this.offsetsFile)
    fs.mkdirSync(dir, { recursive: true })
    const obj: Record<string, { offset: number; lastSize: number }> = {}
    for (const file of this.knownFiles) {
      const entry = this.offsets.get(file)
      if (entry) obj[file] = entry
    }
    const tmp = `${this.offsetsFile}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n')
    fs.renameSync(tmp, this.offsetsFile)
    this.offsetsDirty = false
  }

  private listJsonlFiles(): string[] {
    const out: string[] = []
    if (!fs.existsSync(this.projectsRoot)) return out
    const walk = (dir: string) => {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) walk(full)
        else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
          try {
            const st = fs.statSync(full)
            const tracked = this.offsets.has(full)
            if (!tracked && Date.now() - st.mtimeMs > RECENT_FILE_MS) continue
            out.push(full)
          } catch {
            /* skip */
          }
        }
      }
    }
    walk(this.projectsRoot)
    return out
  }

  private seedOffsetAtEof(filePath: string, stat: fs.Stats): number {
    this.offsets.set(filePath, { offset: stat.size, lastSize: stat.size })
    this.offsetsDirty = true
    return stat.size
  }

  private getSessionState(sessionId: string): ClaudeJsonlSessionState {
    let s = this.sessionState.get(sessionId)
    if (!s) {
      s = { sessionStarted: false, hadToolsInTurn: false }
      this.sessionState.set(sessionId, s)
    }
    return s
  }

  private clearPermissionTimer(sessionId: string): void {
    const t = this.permissionTimers.get(sessionId)
    if (t) clearTimeout(t)
    this.permissionTimers.delete(sessionId)
  }

  private schedulePermissionTimer(sessionId: string): void {
    this.clearPermissionTimer(sessionId)
    const timer = setTimeout(() => {
      if (!this.emit) return
      this.emit({
        id: `${sessionId}:permission:${Date.now()}`,
        ts: Date.now(),
        source: 'claude-session-log',
        providerId: this.id,
        agentId: 'claude-code',
        sessionId,
        kind: 'permission',
        status: 'working',
        activity: 'waiting',
        activityDepth: 'brief',
        detail: 'Claude Code — waiting for permission',
      })
    }, this.permissionTimerMs)
    this.permissionTimers.set(sessionId, timer)
  }

  private tailFile(filePath: string): void {
    if (!this.emit) return
    this.knownFiles.add(filePath)
    const sessionId = sessionIdFromJsonlPath(filePath)
    const state = this.getSessionState(sessionId)

    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      return
    }

    const saved = this.offsets.get(filePath)
    let offset = saved ? saved.offset : this.seedOffsetAtEof(filePath, stat)

    if (saved && stat.size < saved.lastSize) {
      offset = 0
    } else if (stat.size < offset) {
      offset = 0
    }

    if (stat.size === offset) {
      return
    }

    if (offset > 0 && offset < stat.size) {
      const probe = Buffer.alloc(1)
      const pfd = fs.openSync(filePath, 'r')
      fs.readSync(pfd, probe, 0, 1, offset)
      fs.closeSync(pfd)
      if (probe[0] !== 0x7b) {
        offset = 0
      }
    }

    if (stat.size <= offset) return

    const fd = fs.openSync(filePath, 'r')
    const len = stat.size - offset
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, offset)
    fs.closeSync(fd)

    const startOffset = offset
    const chunk = buf.toString('utf-8')

    const parts = chunk.split('\n')
    let incomplete = ''
    if (!chunk.endsWith('\n')) {
      incomplete = parts.pop() || ''
    }

    let endOfCompleteLines = startOffset
    let lineStart = startOffset

    for (const line of parts) {
      if (!line.length && parts.length === 1) continue
      const lineBytes = Buffer.byteLength(line, 'utf-8') + 1
      const byteOffset = lineStart

      const result = parseClaudeJsonlLine(
        line,
        { sessionId, filePath, byteOffset },
        state
      )

      if (result.schedulePermissionTimer) this.schedulePermissionTimer(sessionId)
      if (result.cancelPermissionTimer) this.clearPermissionTimer(sessionId)
      if (result.refreshPermissionTimer) this.schedulePermissionTimer(sessionId)

      for (const ev of result.events) this.emit!(ev)

      lineStart += lineBytes
      endOfCompleteLines = lineStart
    }

    const newOffset = incomplete ? endOfCompleteLines : stat.size
    const prev = this.offsets.get(filePath)
    if (!prev || prev.offset !== newOffset || prev.lastSize !== stat.size) {
      this.offsets.set(filePath, { offset: newOffset, lastSize: stat.size })
      this.offsetsDirty = true
    }
  }

  private poll(): void {
    const files = this.listJsonlFiles()
    const live = new Set(files)
    for (const f of this.knownFiles) {
      if (!live.has(f)) {
        this.knownFiles.delete(f)
        this.offsets.delete(f)
        this.offsetsDirty = true
      }
    }
    for (const file of files) {
      this.tailFile(file)
    }
    this.saveOffsetsIfDirty()
  }

  start(emit: (event: AgentEvent) => void): void {
    this.emit = emit
    this.loadOffsets()
    this.poll()
    this.timer = setInterval(() => this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.emit = null
    for (const t of this.permissionTimers.values()) clearTimeout(t)
    this.permissionTimers.clear()
    this.saveOffsetsIfDirty()
  }
}
