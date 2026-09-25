#!/usr/bin/env node
/**
 * Build direction-sizes-before-after.png (4x) for multiple avatars.
 * "Before" strips are read from git parent of the direction-size fix (2e7e62a).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const beforeDir = path.join(root, '.tmp-direction-before');
const BEFORE_REF = '2e7e62a';

const AVATARS = [
  'jarvis.png',
  'friday.png',
  'bumblebee.png',
  'claude.png',
  'gemini.png',
  'grok.png',
  'cursor_grunt01.png',
];

const DIRECTION_FRAMES = {
  down: 0,
  left: 6,
  right: 6,
  up: 3,
};

function ensureBeforeSprites() {
  fs.mkdirSync(beforeDir, { recursive: true });
  for (const sprite of AVATARS) {
    const dest = path.join(beforeDir, sprite);
    if (fs.existsSync(dest)) continue;
    try {
      const buf = execSync(`git show ${BEFORE_REF}:public/assets/sprites/${sprite}`, {
        cwd: root,
        encoding: 'buffer',
        maxBuffer: 4 * 1024 * 1024,
      });
      fs.writeFileSync(dest, buf);
    } catch (e) {
      console.warn('No before ref for', sprite, e.message);
    }
  }
}

async function main() {
  ensureBeforeSprites();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  const cells = [];
  for (const sprite of AVATARS) {
    const beforePath = path.join(beforeDir, sprite);
    const afterPath = path.join(root, 'public/assets/sprites', sprite);
    if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) continue;
    const beforeB64 = fs.readFileSync(beforePath).toString('base64');
    const afterB64 = fs.readFileSync(afterPath).toString('base64');
    const label = sprite.replace('.png', '');
    for (const [dir, frame] of Object.entries(DIRECTION_FRAMES)) {
      cells.push(`
        <div style="text-align:center;margin:4px">
          <div style="font:10px monospace;color:#ccc">${label} · ${dir}</div>
          <div style="display:flex;gap:6px;justify-content:center">
            <div><div style="font:8px;color:#888">before</div><canvas class="c" data-b64="${beforeB64}" data-f="${frame}" data-flip="${dir === 'right' ? 1 : 0}"></canvas></div>
            <div><div style="font:8px;color:#8cf">after</div><canvas class="c" data-b64="${afterB64}" data-f="${frame}" data-flip="${dir === 'right' ? 1 : 0}"></canvas></div>
          </div>
        </div>`);
    }
  }

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0b0c1e;color:#eee">
  <h3 style="font:13px monospace;padding:8px">Direction sizes 4× — systematic side-row fix (converter uniform height; renderer same dest rect all directions)</h3>
  <div style="display:flex;flex-wrap:wrap;padding:8px">${cells.join('')}</div>
  <script>
  const Z=4;
  async function draw(canvas){
    const b64=canvas.dataset.b64;
    const frame=+canvas.dataset.f;
    const flip=canvas.dataset.flip==='1';
    canvas.width=16*Z; canvas.height=32*Z;
    const img=new Image();
    await new Promise((ok,err)=>{img.onload=ok;img.onerror=err;img.src='data:image/png;base64,'+b64;});
    const ctx=canvas.getContext('2d');
    ctx.imageSmoothingEnabled=false;
    if(flip){ctx.translate(16*Z,0);ctx.scale(-1,1);}
    ctx.drawImage(img, frame*16, 0, 16, 32, 0, 0, 16*Z, 32*Z);
  }
  (async()=>{for(const c of document.querySelectorAll('.c')) await draw(c);})();
  </script></body></html>`;

  const htmlPath = path.join(root, '.tmp-screenshots/direction-sizes.html');
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);
  await page.goto('file://' + htmlPath);
  await page.waitForTimeout(1000);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'direction-sizes-before-after.png');
  await page.screenshot({ path: outPath, fullPage: true });
  console.log('Wrote', outPath);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
