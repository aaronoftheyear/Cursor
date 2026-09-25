import { ActivityFeed } from '../server/agentActivity/activityFeed.ts'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const feed = new ActivityFeed({ projectRoot })
feed.start()
console.log('[agent-activity-feed] Running (Claude session-log fallback)')

process.on('SIGINT', () => {
  feed.stop()
  process.exit(0)
})
