import { ActivityFeed, loadAgentNameHints } from '../server/agentActivity/activityFeed.ts'
import { loadEnv } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = loadEnv('development', projectRoot, '')

const feed = new ActivityFeed({
  projectRoot,
  cursorApiKey: env.CURSOR_API_KEY || undefined,
  agentNameHints: loadAgentNameHints(projectRoot),
})
feed.start()
console.log('[agent-activity-feed] Running (Claude log fallback + external status + Cursor API)')

process.on('SIGINT', () => {
  feed.stop()
  process.exit(0)
})
