#!/usr/bin/env node
/**
 * Standalone agent activity feed (same providers as Vite dev server).
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const tsx = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const { spawn } = await import('node:child_process')

const child = spawn(process.execPath, ['--import', 'tsx', path.join(__dirname, 'run-activity-feed.mts')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 0))
