#!/usr/bin/env node
/**
 * Avatars must have the same visible character height in every direction (idle frames).
 * Renderer draws the full 16x32 cell at a fixed size; per-direction bbox differences
 * would change on-screen character size without this strip normalization.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;

const spritesDir = path.resolve(__dirname, '../public/assets/sprites');
const manifestPath = path.resolve(__dirname, '../public/assets/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

const IDLE_FRAME_BY_DIRECTION = { down: 0, up: 3, left: 6 };
const MAX_SPREAD_PX = 1;

/**
 * Side-facing source art is often narrower than down/up (true in Aaron's sheets).
 * Height must still match; width may differ for these agents.
 */
const NARROW_SIDE_VIEW_AGENTS = new Set(['grokbot', 'metabee']);

console.log('\n=== Direction Frame Size Tests ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function visibleBox(png, frameIndex, frameW = 16, frameH = 32) {
  const fx = frameIndex * frameW;
  let minX = frameW;
  let minY = frameH;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < frameW; x++) {
      const a = png.data[((y * png.width) + (fx + x)) * 4 + 3];
      if (a > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return null;
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

function measureStrip(spritePath) {
  const buffer = fs.readFileSync(spritePath);
  const png = PNG.sync.read(buffer);
  if (png.width !== 144 || png.height !== 32) {
    return null;
  }
  const byDir = {};
  for (const [dir, frameIndex] of Object.entries(IDLE_FRAME_BY_DIRECTION)) {
    byDir[dir] = visibleBox(png, Number(frameIndex));
  }
  return byDir;
}

function agentSpriteFile(agentId) {
  const rel = manifest.agents[agentId]?.sprite;
  if (!rel) return null;
  return path.join(spritesDir, path.basename(rel));
}

for (const agentId of Object.keys(manifest.agents)) {
  const spritePath = agentSpriteFile(agentId);
  if (!spritePath || !fs.existsSync(spritePath)) continue;
  const png = PNG.sync.read(fs.readFileSync(spritePath));
  if (png.width !== 144 || png.height !== 32) continue;

  test(`${agentId}: idle visible height consistent across directions`, () => {
    const byDir = measureStrip(spritePath);
    assert.ok(byDir, 'expected 144x32 strip');
    const heights = Object.values(byDir).map((b) => b.h);
    const widths = Object.values(byDir).map((b) => b.w);
    const hSpread = Math.max(...heights) - Math.min(...heights);
    const wSpread = Math.max(...widths) - Math.min(...widths);
    assert.ok(
      hSpread <= MAX_SPREAD_PX,
      `${agentId} height spread ${hSpread}px (down=${byDir.down.h} up=${byDir.up.h} left=${byDir.left.h})`
    );
    if (!NARROW_SIDE_VIEW_AGENTS.has(agentId)) {
      assert.ok(
        wSpread <= MAX_SPREAD_PX,
        `${agentId} width spread ${wSpread}px (side view may be narrower for grokbot/metabee only)`
      );
    }
  });
}

test('Jarvis left/down idle heights match within 1px', () => {
  const byDir = measureStrip(path.join(spritesDir, 'jarvis.png'));
  assert.strictEqual(byDir.down.h, byDir.left.h);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
