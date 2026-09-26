#!/usr/bin/env node
/**
 * Tests cursor-cloud scaling and click box using real agentDisplayMath exports
 * (same functions Renderer.spritePixelSize / agentClickBox use).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

console.log('\n=== Cursor Cloud Scale Tests (real agentDisplayMath) ===\n');

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

const manifestPath = path.resolve(__dirname, '../public/assets/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
const mathPath = path.resolve(__dirname, '../src/agentDisplayMath.ts');

function callMath(fnName, ...args) {
  const argsJson = args.map((a) => JSON.stringify(a)).join(', ');
  const code = `
    const m = require('${mathPath.replace(/\\/g, '\\\\')}');
    console.log(JSON.stringify(m.${fnName}(${argsJson})));
  `;
  const result = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    encoding: 'utf-8',
    cwd: path.resolve(__dirname, '..'),
  });
  return JSON.parse(result.trim());
}

try {
  const verify = callMath('spritePixelSizeFromFrames', 16, 32, 32, 1);
  if (!verify.width) throw new Error('import failed');
  console.log('✓ Imported spritePixelSizeFromFrames and agentClickBoxBounds\n');
} catch (e) {
  console.error('FATAL:', e.message);
  process.exit(1);
}

const TILE = 32;
const cursorCloud = manifest.agents['cursor-cloud'];
const jarvis = manifest.agents.jarvis;

test('cursor-cloud manifest has displayScale and clickBoxTiles', () => {
  assert.ok(cursorCloud.displayScale > 0.7 && cursorCloud.displayScale < 0.9);
  assert.ok(cursorCloud.clickBoxTiles);
});

test('spritePixelSizeFromFrames: 64x64 + displayScale matches cursor-cloud', () => {
  const size = callMath(
    'spritePixelSizeFromFrames',
    64,
    64,
    TILE,
    cursorCloud.displayScale
  );
  assert.strictEqual(size.width, Math.round(64 * cursorCloud.displayScale));
  assert.strictEqual(size.height, Math.round(64 * cursorCloud.displayScale));
});

test('removing displayScale would change rendered size (regression)', () => {
  const scaled = callMath('spritePixelSizeFromFrames', 64, 64, TILE, cursorCloud.displayScale);
  const unscaled = callMath('spritePixelSizeFromFrames', 64, 64, TILE, 1);
  assert.notStrictEqual(scaled.height, unscaled.height);
});

test('jarvis visible render height within 10% of cursor-cloud (tile 37)', () => {
  const rendererPath = path.resolve(__dirname, '../src/renderer.ts');
  const code = `
    const r = require('${rendererPath.replace(/\\/g, '\\\\')}');
    const manifest = ${JSON.stringify(manifest)};
    const j = r.resolveAgentVisibleRenderHeight('jarvis', manifest, 21, 32, 37);
    const c = r.resolveAgentVisibleRenderHeight('cursor-cloud', manifest, 50, 64, 37);
    console.log(JSON.stringify({ j, c, ratio: c / j }));
  `;
  const { ratio } = JSON.parse(
    execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    }).trim()
  );
  assert.ok(ratio >= 0.9 && ratio <= 1.1, `visible height ratio ${ratio}`);
});

test('agentClickBoxBounds: bottom-aligned (not top-left)', () => {
  const spriteSize = callMath('spritePixelSizeFromFrames', 64, 64, TILE, cursorCloud.displayScale);
  const box = callMath(
    'agentClickBoxBounds',
    100,
    200,
    spriteSize,
    TILE,
    cursorCloud.clickBoxTiles
  );
  const topLeftY = 200;
  const bottomAlignedY = 200 + spriteSize.height - cursorCloud.clickBoxTiles.height * TILE;
  assert.strictEqual(box.y, bottomAlignedY);
  assert.notStrictEqual(box.y, topLeftY);
});

test('agentClickBoxBounds: centered horizontally', () => {
  const spriteSize = callMath('spritePixelSizeFromFrames', 64, 64, TILE, cursorCloud.displayScale);
  const box = callMath(
    'agentClickBoxBounds',
    50,
    80,
    spriteSize,
    TILE,
    cursorCloud.clickBoxTiles
  );
  const clickW = cursorCloud.clickBoxTiles.width * TILE;
  assert.strictEqual(box.x, 50 + (spriteSize.width - clickW) / 2);
});

test('cursor-cloud shadow ellipse matches jarvis (1-tile foot, not full sprite width)', () => {
  const jarvisSize = callMath('spritePixelSizeFromFrames', 16, 32, TILE, jarvis.displayScale ?? 1);
  const cloudSize = callMath('spritePixelSizeFromFrames', 64, 64, TILE, cursorCloud.displayScale);
  const jarvisShadow = callMath('agentShadowEllipseRadii', jarvisSize, TILE, null, 1);
  const cloudShadow = callMath(
    'agentShadowEllipseRadii',
    cloudSize,
    TILE,
    cursorCloud.clickBoxTiles,
    cursorCloud.shadowScale ?? 1
  );
  assert.strictEqual(cloudShadow.radiusX, jarvisShadow.radiusX);
  assert.strictEqual(cloudShadow.radiusY, jarvisShadow.radiusY);
  const wideSpriteShadow = callMath('agentShadowEllipseRadii', cloudSize, TILE, null, 1);
  assert.ok(
    wideSpriteShadow.radiusX > cloudShadow.radiusX,
    'Using full sprite width would make an oversized shadow'
  );
});

test('top-left click box variant fails bottom-align check', () => {
  const spriteSize = callMath('spritePixelSizeFromFrames', 64, 64, TILE, cursorCloud.displayScale);
  const box = callMath(
    'agentClickBoxBounds',
    10,
    20,
    spriteSize,
    TILE,
    cursorCloud.clickBoxTiles
  );
  const wrongTopLeft = {
    x: 10,
    y: 20,
    width: cursorCloud.clickBoxTiles.width * TILE,
    height: cursorCloud.clickBoxTiles.height * TILE,
  };
  assert.notDeepStrictEqual(
    { x: box.x, y: box.y, width: box.width, height: box.height },
    wrongTopLeft
  );
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
