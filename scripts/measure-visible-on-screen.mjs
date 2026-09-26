#!/usr/bin/env node
/**
 * Measure visible character height (non-transparent bbox) in rendered canvas at a given map tile size.
 * Usage: node scripts/measure-visible-on-screen.mjs [--tile=37] [--branch=pr]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const manifestPath = path.join(root, 'public/assets/manifest.json');

const args = process.argv.slice(2);
const tileArg = args.find((a) => a.startsWith('--tile='));
const MAP_TILE = tileArg ? Number(tileArg.split('=')[1]) : 37;
const useMain = args.includes('--main');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const original = fs.readFileSync(manifestPath, 'utf-8');
  if (useMain) {
    fs.writeFileSync(manifestPath, execSync('git show origin/main:public/assets/manifest.json', { encoding: 'utf-8', cwd: root }));
  }
  execSync('npx playwright install chromium', { cwd: root, stdio: 'inherit' });
  try {
    execSync('pkill -f "vite.*5173" 2>/dev/null || true', { shell: true });
  } catch {
    /* ignore */
  }
  const dev = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--force'], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, BROWSER: 'none' },
  });
  try {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      try {
        const res = await fetch('http://127.0.0.1:5173/');
        if (res.ok) break;
      } catch {
        /* retry */
      }
      await sleep(400);
    }
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`http://127.0.0.1:5173/?mapTile=${MAP_TILE}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__aiDashboard?.engine), null, { timeout: 120000 });
    await sleep(5000);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const ids = Object.keys(manifest.agents);
    const results = {};

    for (const id of ids) {
      await page.goto(
        `http://127.0.0.1:5173/?mapTile=${MAP_TILE}&debugPin=${encodeURIComponent(`${id}@12,10,down`)}&debugHide=1`,
        { waitUntil: 'domcontentloaded' }
      );
      await page.waitForFunction(() => Boolean(window.__aiDashboard?.engine), null, { timeout: 60000 });
      await sleep(4500);
      const h = await page.evaluate((agentId) => {
        const dash = window.__aiDashboard;
        const agent = dash.engine.getAgents().find((a) => a.id === agentId);
        const canvas = document.getElementById('game-canvas');
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const data = ctx.getImageData(0, 0, w, h).data;
        const ax = Math.round(agent.x);
        const ay = Math.round(agent.y);
        const rw = 80;
        const rh = 120;
        let minY = h;
        let maxY = -1;
        for (let y = Math.max(0, ay - 20); y < Math.min(h, ay + rh); y++) {
          for (let x = Math.max(0, ax - 20); x < Math.min(w, ax + rw); x++) {
            const i = (y * w + x) * 4;
            const a = data[i + 3];
            if (a < 16) continue;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (r < 12 && g < 12 && b < 12) continue;
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
        return maxY >= minY ? maxY - minY + 1 : 0;
      }, id);
      results[id] = h;
    }
    await browser.close();
    const jarvis = results.jarvis || 1;
    console.log(JSON.stringify({ mapTile: MAP_TILE, useMain, results, pctOfJarvis: Object.fromEntries(
      Object.entries(results).map(([k, v]) => [k, Math.round((v / jarvis) * 1000) / 10])
    ) }, null, 2));
  } finally {
    dev.kill('SIGTERM');
    if (useMain) fs.writeFileSync(manifestPath, original);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
