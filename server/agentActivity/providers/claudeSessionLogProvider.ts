/**
 * Claude session JSONL fallback — tails ~/.claude/projects (recursive .jsonl)
 * (pixel-agents fileWatcher tail-only pattern, MIT).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseClaudeJsonlLine, sessionIdFromJsonlPath } from '../claudeJsonlParser'
import type { AgentActivityProvider, AgentEvent } from '../types'

const POLL_MS = 500
const STARTUP_TAIL_BYTES = 64 * 1024

export interface ClaudeSessionLogOptions {
  projectsRoot?: string
  offsetsFile?: string
}

export class ClaudeSessionLogProvider implements AgentActivityProvider {
  readonly id = 'claude-session-log'
  private timer: ReturnType<typeof setInterval> | null = null
  private emit: ((e: AgentEvent) => void) | null = null
  private offsets = new Map<string, number>()
  private readonly projectsRoot: string
  private readonly offsetsFile: string

  constructor(
    projectRoot: string,
    options: ClaudeSessionLogOptions = {}
  ) {
    this.projectsRoot =
      options.projectsRoot ?? path.join(os.homedir(), '.claude', 'projects')
    this.offsetsFile =
      options.offsetsFile ??
      path.join(projectRoot, '.dashboard', 'claude-jsonl-offsets.json')
  }

  private loadOffsets(): void {
    try {
      if (!fs.existsSync(this.offsetsFile)) return
      const data = JSON.parse(fs.readFileSync(this.offsetsFile, 'utf-8')) as Record<
        string,
        number
      >
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'number') this.offsets.set(k, v)
      }
    } catch {
      /* ignore */
    }
  }

  private saveOffsets(): void {
    const dir = path.dirname(this.offsetsFile)
    fs.mkdirSync(dir, { recursive: true })
    const obj: Record<string, number> = {}
    for (const [k, v] of this.offsets) obj[k] = v
    fs.writeFileSync(this.offsetsFile, JSON.stringify(obj, null, 2) + '\n')
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
        else if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(full)
      }
    }
    walk(this.projectsRoot)
    return out
  }

  private seedOffset(filePath: string): number {
    if (this.offsets.has(filePath)) return this.offsets.get(filePath)!
    try {
      const stat = fs.statSync(filePath)
      const start = Math.max(0, stat.size - STARTUP_TAIL_BYTES)
      this.offsets.set(filePath, start)
      return start
    } catch {
      this.offsets.set(filePath, 0)
      return 0
    }
  }

  private tailFile(filePath: string): void {
    if (!this.emit) return
    const sessionId = sessionIdFromJsonlPath(filePath)
    let offset = this.seedOffset(filePath)
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      return
    }
    if (stat.size < offset) offset = 0
    if (stat.size <= offset) return

    const fd = fs.openSync(filePath, 'r')
    const len = stat.size - offset
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, offset)
    fs.closeSync(fd)
    this.offsets.set(filePath, stat.size)

    const chunk = buf.toString('utf-8')
    const lines = chunk.split('\n')
    let lineIndex = 0
    for (const line of lines) {
      if (!line.trim()) continue
      const events = parseClaudeJsonlLine(line, {
        sessionId,
        filePath,
        lineIndex,
      })
      for (const ev of events) this.emit!(ev)
      lineIndex++
    }
  }

  private poll(): void {
    for (const file of this.listJsonlFiles()) {
      this.tailFile(file)
    }
    this.saveOffsets()
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
    this.saveOffsets()
  }
}
