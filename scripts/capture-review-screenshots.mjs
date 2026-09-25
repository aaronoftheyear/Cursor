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
    const pad = layout.tile * 0.75;
    return {
      x: rect.left + (x - pad) * scaleX,
      y: rect.top + (y - pad) * scaleY,
      width: (w + pad * 2) * scaleX,
      height: (h + pad * 2) * scaleY,
    };
  }, clipTiles);
}

async function captureCanvasClip(page, clip) {
  const canvas = page.locator('#game-canvas');
  await canvas.waitFor({ state: 'visible' });
  return canvas.screenshot({ clip });
}

async function captureRegion(page, url, clipTiles) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForDashboard(page);
  const clip = await tileClip(page, clipTiles);
  return captureCanvasClip(page, clip);
}

async function buildSideBySide4x(page, leftBuf, rightBuf, labels, outName) {
  const leftB64 = leftBuf.toString('base64');
  const rightB64 = rightBuf.toString('base64');
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0a0a12">
  <div style="display:flex;gap:24px;padding:16px;font:14px monospace;color:#ddd">
    <div><div>${labels[0]}</div><canvas id="l"></canvas></div>
    <div><div>${labels[1]}</div><canvas id="r"></canvas></div>
  </div>
  <script>
  const Z=4;
  const LEFT='${leftB64}';
  const RIGHT='${rightB64}';
  async function blit(id, b64) {
    const c=document.getElementById(id);
    const img=new Image();
    await new Promise((ok,err)=>{img.onload=ok;img.onerror=err;img.src='data:image/png;base64,'+b64;});
    c.width=img.width*Z; c.height=img.height*Z;
    const ctx=c.getContext('2d');
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(img,0,0,c.width,c.height);
  }
  (async()=>{await blit('l',LEFT);await blit('r',RIGHT);})();
  </script></body></html>`;
  const htmlPath = path.join(root, '.tmp-screenshots/compare.html');
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  await page.goto('file://' + htmlPath);
  await sleep(800);
  await page.screenshot({ path: path.join(outDir, outName), fullPage: true });
  console.log('Wrote', outName);
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
        key: 'wall',
        name: 'wall-front-over-avatar.png',
        pin: 'jarvis@10,19',
        clip: { tx: 6, ty: 17, tw: 9, th: 6 },
        labels: ['Row-21 fence area (no avatar)', 'Jarvis @10,19 — wall-front over lower body'],
      },
      {
        key: 'shadow',
        name: 'shadow-under-furniture.png',
        pin: 'jarvis@16,6',
        clip: { tx: 14, ty: 4, tw: 8, th: 6 },
        labels: ['Furniture-mid @17,6 (no avatar)', 'Jarvis beside mid furniture — shadow under mid'],
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
