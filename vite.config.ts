import fs from 'node:fs'
import path from 'node:path'
import type { Connect } from 'vite'
import { defineConfig } from 'vite'

function liveStatusMiddleware(
  _req: Connect.IncomingMessage,
  res: Connect.ServerResponse,
  next: Connect.NextFunction
): void {
  const livePath = path.join(process.cwd(), '.dashboard', 'live-status.json')
  const publicPath = path.join(process.cwd(), 'public', 'live-status.json')
  const target = fs.existsSync(livePath) ? livePath : publicPath

  if (!fs.existsSync(target)) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ agents: {}, activeSessions: 0 }))
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  fs.createReadStream(target).pipe(res)
}

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
  },
  plugins: [
    {
      name: 'dashboard-live-status',
      configureServer(server) {
        server.middlewares.use('/live-status.json', liveStatusMiddleware)
      },
      configurePreviewServer(server) {
        server.middlewares.use('/live-status.json', liveStatusMiddleware)
      },
    },
  ],
})
