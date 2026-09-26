#!/usr/bin/env node
/**
 * Avatar visible-height normalization (tile 37, facing down idle).
 * Uses resolveAgentSpritePixelSize from renderer.ts (same draw path as Renderer).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const PNG = require('pngjs').PNG;
const { execSync } = require('child_process');

console.log('\n=== Avatar Size Normalization Tests ===\n');

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

const spritesDir = path.resolve(__dirname, '../public/assets/sprites');
const manifestPath = path.resolve(__dirname, '../public/assets/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
const rendererPath = path.resolve(__dirname, '../src/renderer.ts');

const TILE = 37;
const TOLERANCE_PCT = 5;

function resolveSpritePixelSize(agentId, frameWidth, frameHeight) {
  const code = `
    const r = require('${rendererPath.replace(/\\/g, '\\\\')}');
    const manifest = ${JSON.stringify(manifest)};
    console.log(JSON.stringify(r.resolveAgentSpritePixelSize('${agentId}', manifest, ${frameWidth}, ${frameHeight}, ${TILE})));
  `;
  return JSON.parse(
    execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    }).trim()
  );
}

function visibleRenderHeight(agentId, visibleHeight, frameWidth, frameHeight) {
  const spriteSize = resolveSpritePixelSize(agentId, frameWidth, frameHeight);
  return visibleHeight * (spriteSize.height / frameHeight);
}

function measureDownIdleVisible(spritePath) {
  const buffer = fs.readFileSync(spritePath);
  const png = PNG.sync.read(buffer);
  let frameW;
  let frameH;
  let frameX;
  let frameY;
  if (png.width === 144 && png.height === 32) {
    frameW = 16;
    frameH = 32;
    frameX = 0;
    frameY = 0;
  } else if (png.width === 256 && png.height === 256) {
    frameW = 64;
    frameH = 64;
    frameX = 0;
    frameY = 0;
  } else {
    throw new Error(`Unknown sprite format: ${png.width}x${png.height}`);
  }
  let minY = frameH;
  let maxY = -1;
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < frameW; x++) {
      const idx = ((frameY + y) * png.width + (frameX + x)) * 4;
      if (png.data[idx + 3] > 0) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const visible = maxY >= minY ? maxY - minY + 1 : 0;
  return { visible, frameWidth: frameW, frameHeight: frameH };
}

function getRenderedHeight(agentId) {
  const cfg = manifest.agents[agentId];
  const spritePath = path.join(spritesDir, path.basename(cfg.sprite));
  const { visible, frameHeight, frameWidth } = measureDownIdleVisible(spritePath);
  const renderedHeight = visibleRenderHeight(agentId, visible, frameWidth, frameHeight);
  return {
    agentId,
    visibleHeight: visible,
    frameWidth,
    frameHeight,
    displayScale: cfg.displayScale ?? 1,
    renderedHeight,
  };
}

const HAND_TUNED_TARGET_PCT = {
  'claude-code': 100,
  grokbot: 93,
  metabee: 90,
  'apple-intelligence': 95,
};

console.log('--- Measuring All Agents (visible render height, tile 37, facing down) ---\n');

const targetInfo = getRenderedHeight('jarvis');
const targetHeight = targetInfo.renderedHeight;

console.log(
  `Target (jarvis): visible=${targetInfo.visibleHeight}px, rendered=${targetHeight.toFixed(1)}px\n`
);

console.log(
  'Agent'.padEnd(20) +
    'Visible'.padEnd(10) +
    'Scale'.padEnd(10) +
    'Rendered'.padEnd(12) +
    '% Jarvis'.padEnd(12) +
    'Status'
);
console.log('-'.repeat(80));

const results = [];
for (const agentId of Object.keys(manifest.agents)) {
  const info = getRenderedHeight(agentId);
  const pct = (info.renderedHeight / targetHeight) * 100;
  const hand = HAND_TUNED_TARGET_PCT[agentId];
  const ok = hand
    ? Math.abs(pct - hand) <= 2
    : Math.abs(pct - 100) <= TOLERANCE_PCT;
  results.push({ ...info, pct, hand });
  console.log(
    agentId.padEnd(20) +
      String(info.visibleHeight).padEnd(10) +
      String(info.displayScale).padEnd(10) +
      info.renderedHeight.toFixed(1).padEnd(12) +
      `${pct.toFixed(1)}%`.padEnd(12) +
      (ok ? '✓' : '⚠️')
  );
}

console.log('\n--- Size Validation Tests ---\n');

test('resolveAgentSpritePixelSize is exported from renderer', () => {
  const code = `
    const r = require('${rendererPath.replace(/\\/g, '\\\\')}');
    console.log(typeof r.resolveAgentSpritePixelSize === 'function');
  `;
  assert.strictEqual(
    execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' }).trim(),
    'true'
  );
});

for (const result of results) {
  const hand = HAND_TUNED_TARGET_PCT[result.agentId];
  if (hand) {
    test(`${result.agentId}: hand-tuned ~${hand}% Jarvis visible height`, () => {
      assert.ok(
        Math.abs(result.pct - hand) <= 2,
        `${result.agentId}: ${result.pct.toFixed(1)}% (target ${hand}%)`
      );
      assert.ok(manifest.agents[result.agentId].displayScaleManual);
    });
    continue;
  }
  test(`${result.agentId}: within ±${TOLERANCE_PCT}% of Jarvis visible height`, () => {
    assert.ok(
      Math.abs(result.pct - 100) <= TOLERANCE_PCT,
      `${result.agentId}: ${result.pct.toFixed(1)}% of Jarvis`
    );
  });
}

test('Passing displayScale=1 when manifest scale differs fails normalization', () => {
  const meta = results.find((r) => r.agentId === 'metabee');
  const wrongManifest = {
    ...manifest,
    agents: {
      ...manifest.agents,
      metabee: { ...manifest.agents.metabee, displayScale: 1 },
    },
  };
  const code = `
    const r = require('${rendererPath.replace(/\\/g, '\\\\')}');
    const manifest = ${JSON.stringify(wrongManifest)};
    const size = r.resolveAgentSpritePixelSize('metabee', manifest, ${meta.frameWidth}, ${meta.frameHeight}, ${TILE});
    console.log(JSON.stringify(${meta.visibleHeight} * (size.height / ${meta.frameHeight})));
  `;
  const wrongHeight = JSON.parse(
    execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    }).trim()
  );
  const pct = (wrongHeight / targetHeight) * 100;
  assert.ok(Math.abs(pct - 100) > TOLERANCE_PCT, `Metabee at scale 1 should be ${pct.toFixed(1)}% not ~100%`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
