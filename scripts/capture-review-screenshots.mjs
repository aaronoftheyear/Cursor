#!/usr/bin/env node
/**
 * Capture review screenshots via headless Chromium + Vite dev server.
 * Usage: node scripts/capture-review-screenshots.mjs [--only=wall,shadow,grok]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const fixturesMainGrok = path.join(root, 'tests/fixtures/main-branch-sprites/grok.png');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensurePlaywright() {
  execSync('npx playwright install chromium', { cwd: root, stdio: 'inherit' });
  const { chromium } = await import('playwright');
  return chromium;
}

function startDevServer() {
  try {
    execSync('pkill -f "vite.*5173" 2>/dev/null || true', { shell: true });
  } catch {
    /* ignore */
  }
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

async function waitForDashboard(page) {
  await page.waitForFunction(() => Boolean(window.__aiDashboard?.engine), null, {
    timeout: 120000,
  });
  await sleep(5000);
}

function tileClip(page, clipTiles) {
  return page.evaluate(({ tx, ty, tw, th }) => {
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
    return {
      x: rect.left + x * scaleX,
      y: rect.top + y * scaleY,
      width: w * scaleX,
      height: h * scaleY,
    };
  }, clipTiles);
}

async function captureMapCropPng(page, clipTiles) {
  const b64 = await page.evaluate(({ tx, ty, tw, th }) => {
    const dash = window.__aiDashboard;
    const canvas = document.getElementById('game-canvas');
    const layout = dash.engine.getMapLayout();
    const x = Math.round(layout.offsetX + tx * layout.tile);
    const y = Math.round(layout.offsetY + ty * layout.tile);
    const w = Math.round(tw * layout.tile);
    const h = Math.round(th * layout.tile);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return out.toDataURL('image/png').split(',')[1];
  }, clipTiles);
  return Buffer.from(b64, 'base64');
}

async function captureRegion(page, url, clipTiles) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForDashboard(page);
  return captureMapCropPng(page, clipTiles);
}

async function buildSideBySide4x(_page, leftBuf, rightBuf, labels, outName) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { PNG } = require('pngjs');
  const Z = 4;
  const left = PNG.sync.read(leftBuf);
  const right = PNG.sync.read(rightBuf);
  const labelH = 28;
  const gap = 24;
  const pad = 16;
  const outW = pad * 2 + left.width * Z + gap + right.width * Z;
  const outH = pad * 2 + labelH + Math.max(left.height, right.height) * Z;
  const out = new PNG({ width: outW, height: outH });
  out.data.fill(10);

  const blitZoom = (src, dx, dy) => {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const si = (src.width * y + x) * 4;
        for (let zy = 0; zy < Z; zy++) {
          for (let zx = 0; zx < Z; zx++) {
            const ox = dx + x * Z + zx;
            const oy = dy + y * Z + zy;
            const oi = (outW * oy + ox) * 4;
            out.data[oi] = src.data[si];
            out.data[oi + 1] = src.data[si + 1];
            out.data[oi + 2] = src.data[si + 2];
            out.data[oi + 3] = src.data[si + 3];
          }
        }
      }
    }
  };
  blitZoom(left, pad, pad + labelH);
  blitZoom(right, pad + left.width * Z + gap, pad + labelH);
  fs.writeFileSync(path.join(outDir, outName), PNG.sync.write(out));
  console.log('Wrote', outName, `${outW}x${outH}`);
}

async function captureCompareScene(page, outName, pin, clipTiles, labels) {
  const without = await captureRegion(page, 'http://127.0.0.1:5173/?debugNoAgents=1', clipTiles);
  const withAvatar = await captureRegion(
    page,
    `http://127.0.0.1:5173/?debugPin=${encodeURIComponent(pin)}&debugHide=1`,
    clipTiles
  );
  await buildSideBySide4x(page, without, withAvatar, labels, outName);
}

function readMainGrokBuffer() {
  if (fs.existsSync(fixturesMainGrok)) {
    return fs.readFileSync(fixturesMainGrok);
  }
  return execSync('git show origin/main:public/assets/sprites/grok.png', {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 2 * 1024 * 1024,
  });
}

function buildExpectedGrokStrip() {
  const tmpStrip = path.join(root, '.tmp-screenshots/grok-pipeline-strip.png');
  const tmpFinal = path.join(root, '.tmp-screenshots/grok-pipeline-final.png');
  fs.mkdirSync(path.dirname(tmpStrip), { recursive: true });
  execSync(
    `python3 scripts/convert-sprite-sheet.py public/assets/sprites/originals/grok-v2.png "${tmpStrip}" --idle-col 2`,
    { cwd: root, stdio: 'pipe' }
  );
  execSync(`python3 scripts/reorder-strip-frames.py "${tmpStrip}" "${tmpFinal}"`, {
    cwd: root,
    stdio: 'pipe',
  });
  return fs.readFileSync(tmpFinal);
}

async function buildGrokIdleProof(page) {
  const mainSprite = readMainGrokBuffer();
  const prSprite = fs.readFileSync(path.join(root, 'public/assets/sprites/grok.png'));
  const pipelineSprite = buildExpectedGrokStrip();
  const toB64 = (buf) => buf.toString('base64');
  const frameCells = [];
  for (let i = 0; i < 9; i++) {
    frameCells.push(
      `['main f${i}', '${toB64(mainSprite)}', ${i}]`,
      `['PR f${i}', '${toB64(prSprite)}', ${i}]`,
      `['pipeline f${i}', '${toB64(pipelineSprite)}', ${i}]`
    );
  }
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#111;color:#eee;font:12px monospace">
<h3 style="margin:8px">Grok frames 4× — main (old idle=f1 walk-swap) vs PR (Aaron idle=original col 2)</h3>
<div style="display:flex;flex-wrap:wrap;gap:10px;padding:8px" id="row"></div>
<script>
const Z=4;
const pairs=[${frameCells.join(',\n')}];
async function draw(label, url, frame) {
  const wrap=document.createElement('div');
  wrap.style.textAlign='center';
  wrap.innerHTML='<div>'+label+'</div>';
  const c=document.createElement('canvas');
  c.width=16*Z; c.height=32*Z;
  wrap.appendChild(c);
  document.getElementById('row').appendChild(wrap);
  const img=new Image();
  await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src='data:image/png;base64,'+url;});
  const ctx=c.getContext('2d');
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(img, frame*16, 0, 16, 32, 0, 0, c.width, c.height);
}
(async()=>{for(const p of pairs)await draw(...p);})();
</script></body></html>`;
  const htmlPath = path.join(root, '.tmp-screenshots/grok-frames-proof.html');
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  await page.goto('file://' + htmlPath);
  await sleep(1200);
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
        key: 'shadow87',
        name: 'shadow-under-furniture-8-7.png',
        pin: 'jarvis@8,7',
        clip: { tx: 5, ty: 4, tw: 6, th: 6 },
        labels: ['6×6 @8,7 (no avatar)', 'Jarvis @8,7 — shadow under furniture-mid'],
      },
      {
        key: 'shadow1715',
        name: 'shadow-under-furniture-17-15.png',
        pin: 'jarvis@17,15',
        clip: { tx: 14, ty: 12, tw: 6, th: 6 },
        labels: ['6×6 @17,15 (no avatar)', 'Jarvis @17,15 — shadow under furniture-mid'],
      },
    ];

    for (const s of scenes) {
      if (only && !only.includes(s.key)) continue;
      await captureCompareScene(page, s.name, s.pin, s.clip, s.labels);
    }

    if (!only || only.includes('grok')) {
      await buildGrokIdleProof(page);
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
