#!/usr/bin/env node
/**
 * Avatar lineup by facing (down/left/right/up), 3× zoom, with draw-height labels.
 * Usage: node scripts/capture-avatar-lineup-directions.mjs [--main]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const manifestPath = path.join(root, 'public/assets/manifest.json');

const AGENT_IDS = [
  'jarvis',
  'friday',
  'bumblebee',
  'cursor',
  'claude',
  'claude-code',
  'grokbot',
  'metabee',
  'gemini',
  'laya',
  'cursor-cloud',
  'apple-intelligence',
  'claude-cowork',
  'cursor-grunt',
];

const DIRECTIONS = ['down', 'left', 'right', 'up'];
const LINEUP_FOOT_Y = 10;
const LINEUP_START_X = 6;
const LINEUP_STEP_X = 2;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startDevServer() {
  try {
    execSync('pkill -f "vite.*5173" 2>/dev/null || true', { shell: true });
  } catch {
    /* ignore */
  }
  return spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--force'], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, BROWSER: 'none' },
  });
}

async function waitForServer(url, maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error('Dev server did not start');
}

function measureHeights(manifest) {
  const tsx = path.join(root, 'node_modules/.bin/tsx');
  const code = `
    const fs = require('fs');
    const path = require('path');
    const m = require('./src/agentDisplayMath.ts');
    const manifest = JSON.parse(fs.readFileSync('public/assets/manifest.json','utf8'));
    const tile = 32;
    const out = {};
    for (const id of ${JSON.stringify(AGENT_IDS)}) {
      const cfg = manifest.agents[id];
      if (!cfg) continue;
      const p = path.join('public/assets/sprites', path.basename(cfg.sprite));
      if (!fs.existsSync(p)) continue;
      const PNG = require('pngjs').PNG;
      const png = PNG.sync.read(fs.readFileSync(p));
      const fw = png.width === 144 ? 16 : 64;
      const fh = png.width === 144 ? 32 : 64;
      const scale = cfg.displayScale ?? 1;
      const h = m.spritePixelSizeFromFrames(fw, fh, tile, scale).height;
      out[id] = h;
    }
    console.log(JSON.stringify(out));
  `;
  const raw = execSync(`"${tsx}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    cwd: root,
    encoding: 'utf-8',
  });
  return JSON.parse(raw.trim());
}

async function captureDirection(page, direction, heights, jarvisH, suffix) {
  const pins = AGENT_IDS
    .filter((id) => heights[id])
    .map((id, i) => `${id}@${LINEUP_START_X + i * LINEUP_STEP_X},${LINEUP_FOOT_Y},${direction}`)
    .join(';');
  const url = `http://127.0.0.1:5173/?debugPin=${encodeURIComponent(pins)}&debugHide=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__aiDashboard?.engine), null, { timeout: 120000 });
  await sleep(6000);

  const labels = AGENT_IDS
    .filter((id) => heights[id])
    .map((id) => {
      const h = heights[id];
      const pct = ((h / jarvisH) * 100).toFixed(0);
      return `<div style="font:9px monospace;color:#ccc;text-align:center;width:52px">${id}<br/>${h}px ${pct}%</div>`;
    })
    .join('');

  const shot = await page.locator('#game-canvas').screenshot({
    clip: await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      const r = canvas.getBoundingClientRect();
      const dash = window.__aiDashboard;
      const layout = dash.engine.getMapLayout();
      const sx = r.width / canvas.width;
      const sy = r.height / canvas.height;
      const x = layout.offsetX + 5 * layout.tile;
      const y = layout.offsetY + 6 * layout.tile;
      const w = 30 * layout.tile;
      const h = 5 * layout.tile;
      return { x: r.left + x * sx, y: r.top + y * sy, width: w * sx, height: h * sy };
    }),
  });

  const b64 = shot.toString('base64');
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0b0c1e">
  <h3 style="font:12px monospace;color:#eee;padding:6px">Facing ${direction} · 3× (${suffix})</h3>
  <div style="display:flex;gap:4px;padding:4px 8px">${labels}</div>
  <canvas id="c"></canvas>
  <script>
  const Z=3; const img=new Image();
  img.onload=()=>{const c=document.getElementById('c');c.width=img.width*Z;c.height=img.height*Z;
  const x=c.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(img,0,0,c.width,c.height);};
  img.src='data:image/png;base64,${b64}';
  </script></body></html>`;
  const htmlPath = path.join(root, '.tmp-screenshots', `lineup-${direction}-${suffix}.html`);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const p2 = await browser.newPage();
  await p2.goto('file://' + htmlPath);
  await sleep(600);
  const outName = `avatar-lineup-${direction}-${suffix}.png`;
  await p2.screenshot({ path: path.join(outDir, outName), fullPage: true });
  await browser.close();
  console.log('Wrote', outName);
}

async function main() {
  const useMain = process.argv.includes('--main');
  const original = fs.readFileSync(manifestPath, 'utf-8');
  if (useMain) {
    const mainManifest = execSync('git show origin/main:public/assets/manifest.json', {
      cwd: root,
      encoding: 'utf-8',
    });
    fs.writeFileSync(manifestPath, mainManifest);
  }

  execSync('npx playwright install chromium', { cwd: root, stdio: 'inherit' });
  const heights = measureHeights(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')));
  const jarvisH = heights.jarvis ?? 64;
  const suffix = useMain ? 'main' : 'pr5';

  const dev = startDevServer();
  try {
    await waitForServer('http://127.0.0.1:5173/');
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    for (const dir of DIRECTIONS) {
      await captureDirection(page, dir, heights, jarvisH, suffix);
    }
    await browser.close();
  } finally {
    dev.kill('SIGTERM');
    if (useMain) fs.writeFileSync(manifestPath, original);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
