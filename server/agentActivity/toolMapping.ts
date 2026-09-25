/**
 * Map Claude tool names / shell commands to dashboard activities.
 * Logic aligned with update-dashboard-status.py and pixel-agents claude.ts (MIT).
 */

import type { AgentActivityKind } from './types'

export function isGithubShellCommand(cmd: string): boolean {
  if (!cmd || typeof cmd !== 'string') return false
  const segments = cmd.split(/\s*(?:&&|\|\||[;|])\s*/)
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const words = trimmed.split(/\s+/)
    let i = 0
    while (i < words.length) {
      const word = words[i].toLowerCase()
      if (words[i].includes('=') && !words[i].startsWith('-')) {
        i++
        continue
      }
      if (['cd', 'pushd', 'env', 'sudo', 'time', 'nice', 'nohup'].includes(word)) {
        i++
        if (['cd', 'pushd'].includes(word) && i < words.length && !words[i].startsWith('-')) i++
        continue
      }
      break
    }
    if (i >= words.length) continue
    const cmdWord = words[i].toLowerCase()
    if (cmdWord === 'gh') return true
    if (cmdWord === 'git') {
      let j = i + 1
      while (j < words.length) {
        if (words[j].startsWith('-')) {
          if (['-C', '-c', '--git-dir', '--work-tree'].includes(words[j])) j += 2
          else j++
        } else {
          const sub = words[j].toLowerCase()
          if (['push', 'pull', 'fetch', 'clone', 'commit', 'status'].includes(sub)) return true
          break
        }
      }
    }
  }
  return false
}

export function activityFromToolName(toolName: string, command?: string): AgentActivityKind {
  const tool = toolName.toLowerCase()
  if (tool === 'bash' || tool === 'shell' || tool.endsWith('shell')) {
    if (command && isGithubShellCommand(command)) return 'github'
    return 'running'
  }
  if (tool === 'webfetch' || tool === 'websearch') return 'researching'
  if (['read', 'grep', 'glob', 'list_dir', 'ls', 'semanticsearch'].includes(tool)) {
    return 'reading'
  }
  if (
    [
      'task',
      'switchmode',
      'todo_write',
      'todowrite',
      'creategoal',
      'updategoal',
      'exitplanmode',
      'enterplanmode',
    ].includes(tool)
  ) {
    return 'planning'
  }
  if (
    [
      'write',
      'strreplace',
      'search_replace',
      'edit',
      'multiedit',
      'applypatch',
      'delete',
      'editnotebook',
      'notebookedit',
    ].includes(tool)
  ) {
    return 'editing'
  }
  if (tool.includes('github') || tool.startsWith('github_')) return 'github'
  if (tool === 'askuserquestion') return 'waiting'
  return 'editing'
}
