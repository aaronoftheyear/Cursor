#!/usr/bin/env node
/**
 * Build direction-sizes-before-after.png (4x) for Jarvis and other affected avatars.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const beforeDir = path.join(root, '.tmp-direction-before');

const AVATARS = ['jarvis.png', 'claude_cowork.png'];

const DIRECTION_FRAMES = {
  down: 0,
  left: 6,
  right: 6,
  up: 3,
};

async function main() {
  const { chromium } = await import('playwright');
  await chromium.install?.();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const cells = [];
  for (const sprite of AVATARS) {
    const beforePath = path.join(beforeDir, sprite);
    const afterPath = path.join(root, 'public/assets/sprites', sprite);
    if (!fs.existsSync(beforePath)) continue;
    const beforeB64 = fs.readFileSync(beforePath).toString('base64');
    const afterB64 = fs.readFileSync(afterPath).toString('base64');
    for (const [dir, frame] of Object.entries(DIRECTION_FRAMES)) {
      const flip = dir === 'right' ? 'transform:scaleX(-1);' : '';
      cells.push(`
        <div style="text-align:center;margin:6px">
          <div style="font:11px monospace;color:#ccc">${sprite.replace('.png','')} ${dir}</div>
          <div style="display:flex;gap:8px;justify-content:center">
            <div><div style="font:9px;color:#888">before</div><canvas class="c" data-b64="${beforeB64}" data-f="${frame}" data-flip="${dir === 'right' ? 1 : 0}"></canvas></div>
            <div><div style="font:9px;color:#8cf">after</div><canvas class="c" data-b64="${afterB64}" data-f="${frame}" data-flip="${dir === 'right' ? 1 : 0}"></canvas></div>
          </div>
        </div>`);
    }
  }

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0b0c1e;color:#eee">
  <h3 style="font:14px monospace;padding:8px">Direction sizes 4× (idle frames; right = mirrored left)</h3>
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
  await page.waitForTimeout(800);
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
