#!/usr/bin/env node
/**
 * Left-facing avatars looked larger because strip side-row frames had taller
 * opaque content while the renderer draws the full 16x32 cell at a fixed
 * displayScale for every direction (including horizontal flip). These tests
 * lock that contract: same source rect size and same destination size for
 * all directions; flip only toggles mirror, never width/height.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('\n=== Direction Render Path Tests ===\n');

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

const root = path.resolve(__dirname, '..');
const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
const rendererSrc = fs.readFileSync(path.join(root, 'src/renderer.ts'), 'utf-8');

function callGetSpriteFrame(direction, mirror, mode = 'idle') {
  const code = `
    const { getSpriteFrame } = require('./src/assets.ts');
    const sprite = { layout: 'directionStrip144x32', frameWidth: 16, frameHeight: 32, image: null, framesPerRow: 9, totalFrames: 9 };
    console.log(JSON.stringify(getSpriteFrame(sprite, '${direction}', 0, ${mirror}, '${mode}')));
  `;
  const out = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    cwd: root,
    encoding: 'utf-8',
  });
  return JSON.parse(out.trim());
}

test('drawCustomSprite uses same dest width/height for flip and non-flip', () => {
  assert.ok(rendererSrc.includes('size.width, size.height'), 'drawImage should use size for both paths');
  const flipBlock = rendererSrc.match(
    /if \(frame\.flip\)[\s\S]*?drawImage\([^)]+\)[\s\S]*?else[\s\S]*?drawImage\([^)]+\)/
  );
  assert.ok(flipBlock, 'expected flip branch');
  const block = flipBlock[0];
  assert.ok(block.includes('0, 0, size.width, size.height'), 'flipped draw uses full display size');
  assert.ok(block.includes('agent.x, agent.y, size.width, size.height'), 'unflipped draw uses full display size');
});

test('getSpriteFrame: down/up/left/right use identical 16x32 source rect', () => {
  for (const dir of ['down', 'up', 'left', 'right']) {
    const f = callGetSpriteFrame(dir, true);
    assert.strictEqual(f.width, 16, `${dir} width`);
    assert.strictEqual(f.height, 32, `${dir} height`);
  }
});

test('getSpriteFrame: left unflipped, right flipped (emerald default)', () => {
  assert.strictEqual(callGetSpriteFrame('left', true).flip, false);
  assert.strictEqual(callGetSpriteFrame('right', true).flip, true);
  const left = callGetSpriteFrame('left', true);
  const right = callGetSpriteFrame('right', true);
  assert.strictEqual(left.x, right.x, 'left and right share side-row strip origin');
});

test('getSpriteFrame: walk cycle uses same rect size for left and down', () => {
  const down = callGetSpriteFrame('down', true, 'walk');
  const left = callGetSpriteFrame('left', true, 'walk');
  assert.strictEqual(down.width, left.width);
  assert.strictEqual(down.height, left.height);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
