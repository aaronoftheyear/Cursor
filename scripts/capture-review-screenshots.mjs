#!/usr/bin/env node
/**
 * Capture review screenshots via headless Chromium + Vite dev server.
 * Usage: node scripts/capture-review-screenshots.mjs [--base-url=http://localhost:5173]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensurePlaywright() {
  execSync('npx playwright install chromium', { cwd: root, stdio: 'inherit' });
  const { chromium } = await import('playwright');
  return chromium;
}

function startDevServer() {
  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--force'], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, BROWSER: 'none' },
  });
  return child;
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

async function cropCanvasRegion(page, clip) {
  const canvas = page.locator('#game-canvas');
  await canvas.waitFor({ state: 'visible' });
  return canvas.screenshot({ clip });
}

async function captureScene(page, name, debugPin, clipTiles) {
  const url = `http://127.0.0.1:5173/?debugPin=${encodeURIComponent(debugPin)}&debugHide=1`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await sleep(9000);

  let clip;
  if (clipTiles) {
    clip = await page.evaluate(({ tx, ty, tw, th }) => {
      const dash = window.__aiDashboard;
      if (!dash?.engine) return null;
      const canvas = document.getElementById('game-canvas');
      const rect = canvas.getBoundingClientRect();
      const layout = dash.engine.getMapLayout();
      const scaleX = rect.width / canvas.width;
      const scaleY = rect.height / canvas.height;
      const x = layout.offsetX + tx * layout.tile;
      const y = layout.offsetY + ty * layout.tile;
      const w = tw * layout.tile;
      const h = th * layout.tile;
      const pad = layout.tile * 0.5;
      return {
        x: rect.left + (x - pad) * scaleX,
        y: rect.top + (y - pad) * scaleY,
        width: (w + pad * 2) * scaleX,
        height: (h + pad * 2) * scaleY,
      };
    }, clipTiles);
  }

  const buf = clip
    ? await cropCanvasRegion(page, clip)
    : await page.locator('#game-canvas').screenshot();
  const outPath = path.join(outDir, name);
  fs.writeFileSync(outPath, buf);
  console.log('Wrote', outPath);
}

async function buildGrokBeforeAfter(page) {
  const mainSprite = execSync('git show origin/main:public/assets/sprites/grok.png', {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 2 * 1024 * 1024,
  });
  const prSprite = fs.readFileSync(path.join(root, 'public/assets/sprites/grok.png'));
  const mainB64 = `data:image/png;base64,${mainSprite.toString('base64')}`;
  const prB64 = `data:image/png;base64,${prSprite.toString('base64')}`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#111;color:#eee;font:14px monospace">
<h3 style="margin:8px">Grok idle: main strip vs PR (jarvis/friday/grokbot labels)</h3>
<div style="display:flex;flex-wrap:wrap;gap:16px;padding:8px" id="row"></div>
<script>
const pairs = [
  ['main grok f0', '${mainB64}', 0],
  ['PR grok f0', '${prB64}', 0],
  ['main grok f1', '${mainB64}', 1],
  ['main jarvis f0', 'data:image/png;base64,${fs.readFileSync(path.join(root, 'public/assets/sprites/jarvis.png')).toString('base64')}', 0],
  ['main friday f0', 'data:image/png;base64,${fs.readFileSync(path.join(root, 'public/assets/sprites/friday.png')).toString('base64')}', 0],
];
async function draw(label, url, frame) {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div>'+label+'</div>';
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  wrap.appendChild(c);
  document.getElementById('row').appendChild(wrap);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, frame*16, 0, 16, 32, 16, 0, 32, 64);
}
(async () => { for (const p of pairs) await draw(...p); })();
</script></body></html>`;

  const htmlPath = path.join(root, '.tmp-screenshots/grok-compare.html');
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);

  await page.goto('file://' + htmlPath);
  await sleep(1500);
  await page.screenshot({
    path: path.join(outDir, 'grok-idle-before-after.png'),
    fullPage: true,
  });
  console.log('Wrote grok-idle-before-after.png');
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',') ?? null;

  fs.mkdirSync(outDir, { recursive: true });
  const chromium = await ensurePlaywright();
  const dev = startDevServer();
  try {
    await waitForServer('http://127.0.0.1:5173/');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    const scenes = [
      {
        key: 'wall',
        name: 'wall-front-over-avatar.png',
        pin: 'jarvis@10,20',
        clip: { tx: 6, ty: 19, tw: 10, th: 4 },
      },
      {
        key: 'shadow',
        name: 'shadow-under-furniture.png',
        pin: 'jarvis@5,7',
        clip: { tx: 3, ty: 5, tw: 6, th: 5 },
      },
    ];

    for (const s of scenes) {
      if (only && !only.includes(s.key)) continue;
      await captureScene(page, s.name, s.pin, s.clip);
    }

    if (!only || only.includes('grok')) {
      await buildGrokBeforeAfter(page);
    }

    await browser.close();
  } finally {
    dev.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
