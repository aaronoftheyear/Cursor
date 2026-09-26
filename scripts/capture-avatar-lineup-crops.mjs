#!/usr/bin/env node
/** Per-avatar 3× crops via git worktree (never mutates the real asset tree). */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const outDir = path.join(root, 'docs/screenshots');
const TILE = 37;
const DIRS = ['down', 'left', 'right', 'up'];
const WORKTREE = path.join(root, '.tmp-lineup-main-worktree');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function agentIdsForManifest(manifest) {
  return Object.keys(manifest.agents).filter((id) => {
    const rel = manifest.agents[id]?.sprite;
    if (!rel) return false;
    return fs.existsSync(path.join(root, 'public/assets/sprites', path.basename(rel)));
  });
}

async function measureVisible(agentId, manifest, projectRoot) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const PNG = require('pngjs').PNG;
  const cfg = manifest.agents[agentId];
  const p = path.join(projectRoot, 'public/assets/sprites', path.basename(cfg.sprite));
  const png = PNG.sync.read(fs.readFileSync(p));
  const fw = png.width === 144 ? 16 : 64;
  const fh = png.width === 144 ? 32 : 64;
  let minY = fh;
  let maxY = -1;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      if (png.data[y * png.width * 4 + x * 4 + 3] > 0) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const vis = maxY >= minY ? maxY - minY + 1 : 0;
  const tsx = path.join(projectRoot, 'node_modules/.bin/tsx');
  const code = `const r=require('./src/renderer.ts');const m=${JSON.stringify(manifest)};const s=r.resolveAgentSpritePixelSize('${agentId}',m,${fw},${fh},${TILE});console.log(${vis}*(s.height/${fh}))`;
  const h = parseFloat(
    execSync(`"${tsx}" -e "${code.replace(/"/g, '\\"')}"`, { cwd: projectRoot, encoding: 'utf-8' })
  );
  return { vis, h };
}

function ensureMainWorktree() {
  if (fs.existsSync(path.join(WORKTREE, '.git'))) {
    execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: root, stdio: 'pipe' });
  }
  execSync(`git worktree add --detach "${WORKTREE}" origin/main`, { cwd: root, stdio: 'pipe' });
  if (!fs.existsSync(path.join(WORKTREE, 'node_modules'))) {
    execSync('npm ci', { cwd: WORKTREE, stdio: 'inherit' });
  }
}

function removeMainWorktree() {
  try {
    execSync(`git worktree remove --force "${WORKTREE}"`, { cwd: root, stdio: 'pipe' });
  } catch {
    /* ignore */
  }
}

async function captureFromProject(projectRoot, suffix, manifest) {
  const AGENTS = agentIdsForManifest(manifest);
  const heights = {};
  for (const id of AGENTS) {
    heights[id] = await measureVisible(id, manifest, projectRoot);
  }
  const jarvisH = heights.jarvis?.h || 1;

  execSync('pkill -f "vite.*5173" 2>/dev/null || true', { shell: true });
  const dev = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--force'], {
    cwd: projectRoot,
    stdio: 'pipe',
    env: { ...process.env, BROWSER: 'none' },
  });
  try {
    const start = Date.now();
    while (Date.now() - start < 90000) {
      try {
        if ((await fetch('http://127.0.0.1:5173/')).ok) break;
      } catch {
        /* retry */
      }
      await sleep(400);
    }
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { PNG } = require('pngjs');

    for (const dir of DIRS) {
      const cells = [];
      for (const id of AGENTS) {
        const pin = `${id}@12,10,${dir}`;
        await page.goto(
          `http://127.0.0.1:5173/?debugPin=${encodeURIComponent(pin)}&debugHide=1`,
          { waitUntil: 'domcontentloaded' }
        );
        await page.waitForFunction(() => Boolean(window.__aiDashboard?.engine), null, { timeout: 90000 });
        await sleep(3000);
        const b64 = await page.evaluate(() => {
          const dash = window.__aiDashboard;
          const agent = dash.engine.getAgents().find((a) => a.visibleOnMap !== false);
          const canvas = document.getElementById('game-canvas');
          const ax = Math.round(agent.x);
          const ay = Math.round(agent.y);
          const pad = 24;
          const w = 72;
          const h = 96;
          const x = Math.max(0, ax - pad);
          const y = Math.max(0, ay - h + 8);
          const out = document.createElement('canvas');
          out.width = w;
          out.height = h;
          const ctx = out.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
          return out.toDataURL('image/png').split(',')[1];
        });
        const pct = Math.round((heights[id].h / jarvisH) * 100);
        cells.push({ id, b64, label: `${id} ${heights[id].h.toFixed(1)}px ${pct}%` });
      }
      const Z = 3;
      const cellW = 72 * Z + 8;
      const cellH = 96 * Z + 24;
      const cols = 4;
      const rows = Math.ceil(cells.length / cols);
      const out = new PNG({ width: cols * cellW + 16, height: rows * cellH + 32 });
      out.data.fill(12);
      let ci = 0;
      for (const cell of cells) {
        const col = ci % cols;
        const row = Math.floor(ci / cols);
        const src = PNG.sync.read(Buffer.from(cell.b64, 'base64'));
        const ox = 8 + col * cellW;
        const oy = 24 + row * cellH;
        for (let y = 0; y < src.height; y++) {
          for (let x = 0; x < src.width; x++) {
            for (let zy = 0; zy < Z; zy++) {
              for (let zx = 0; zx < Z; zx++) {
                const si = (src.width * y + x) * 4;
                const dx = ox + x * Z + zx;
                const dy = oy + y * Z + zy;
                const oi = (out.width * dy + dx) * 4;
                out.data[oi] = src.data[si];
                out.data[oi + 1] = src.data[si + 1];
                out.data[oi + 2] = src.data[si + 2];
                out.data[oi + 3] = src.data[si + 3];
              }
            }
          }
        }
        ci++;
      }
      const outPath = path.join(outDir, `avatar-lineup-${dir}-${suffix}.png`);
      fs.writeFileSync(outPath, PNG.sync.write(out));
      console.log('Wrote', path.basename(outPath));
    }
    await browser.close();
  } finally {
    dev.kill('SIGTERM');
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  execSync('npx playwright install chromium', { cwd: root, stdio: 'inherit' });
  const prManifest = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/manifest.json'), 'utf-8'));
  ensureMainWorktree();
  try {
    const mainManifest = JSON.parse(
      fs.readFileSync(path.join(WORKTREE, 'public/assets/manifest.json'), 'utf-8')
    );
    await captureFromProject(WORKTREE, 'main', mainManifest);
    await captureFromProject(root, 'pr5', prManifest);
  } finally {
    removeMainWorktree();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
