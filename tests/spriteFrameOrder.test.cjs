#!/usr/bin/env node
/**
 * Sprite frame order tests using Node.js PNG decoding (pngjs).
 *
 * Verifies that:
 * - For swapped avatars: PR's position 0 = main's position 1 (per direction)
 * - For Metabee: PR's position 0 = main's position 0 (not swapped)
 *
 * The renderer uses STRIP_COL_IDLE=0, so it draws position 0 as idle.
 * After the swap, swapped sprites have walk1 (main's pos 1) at position 0.
 *
 * Run with: node tests/spriteFrameOrder.test.cjs
 */

const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const PNG = require('pngjs').PNG;

console.log('\n=== Sprite Frame Order Tests (Node/pngjs) ===\n');

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

// All 15 swapped sprites (plus grok and grok_grunt which use same swap)
const SWAPPED_SPRITES = [
  'apple.png', 'bumblebee.png', 'claude.png', 'claude_code.png', 'claude_cowork.png',
  'claude_grunt02.png', 'cursor_grunt01.png', 'cursor_grunt02.png', 'friday.png',
  'gemini.png', 'grok.png', 'grok_grunt.png', 'grok-v1.png', 'jarvis.png', 'laya.png',
];

// Metabee uses original order: idle from position 0
const METABEE_SPRITE = 'metabee.png';

// Direction origins in the strip (each direction has 3 frames)
const DIRECTION_ORIGINS = { down: 0, up: 3, left: 6 };

// Import real STRIP_COL constants from assets.ts
let STRIP_COL_IDLE, STRIP_COL_WALK1;
try {
  const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
  const assetsPath = path.resolve(__dirname, '../src/assets.ts');
  
  // Read and extract constants directly from source
  const assetsContent = fs.readFileSync(assetsPath, 'utf-8');
  const idleMatch = assetsContent.match(/const STRIP_COL_IDLE\s*=\s*(\d+)/);
  const walk1Match = assetsContent.match(/const STRIP_COL_WALK1\s*=\s*(\d+)/);
  
  if (!idleMatch || !walk1Match) {
    throw new Error('Could not find STRIP_COL constants in assets.ts');
  }
  
  STRIP_COL_IDLE = parseInt(idleMatch[1], 10);
  STRIP_COL_WALK1 = parseInt(walk1Match[1], 10);
  
  console.log(`✓ Found STRIP_COL_IDLE=${STRIP_COL_IDLE}, STRIP_COL_WALK1=${STRIP_COL_WALK1}\n`);
} catch (e) {
  console.error('FATAL: Failed to read STRIP_COL constants from assets.ts');
  console.error('Error:', e.message);
  process.exit(1);
}

// Decode PNG and extract frame pixels
function extractFramePixels(pngBuffer, frameIndex) {
  const png = PNG.sync.read(pngBuffer);
  if (png.width !== 144 || png.height !== 32) {
    throw new Error(`Expected 144x32, got ${png.width}x${png.height}`);
  }
  
  const frameX = frameIndex * 16;
  const pixels = [];
  
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = ((y * png.width) + (frameX + x)) * 4;
      pixels.push(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]);
    }
  }
  
  return Buffer.from(pixels);
}

// Get sprite from git (main branch)
function getMainSpriteBuffer(sprite) {
  try {
    const result = execSync(`git show origin/main:public/assets/sprites/${sprite}`, {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
    });
    return result;
  } catch (e) {
    return null;
  }
}

// Get current sprite buffer
function getCurrentSpriteBuffer(sprite) {
  const spritePath = path.join(spritesDir, sprite);
  if (!fs.existsSync(spritePath)) return null;
  return fs.readFileSync(spritePath);
}

console.log('--- Swapped Sprites: idle = main\'s position 1 ---\n');

// For swapped sprites, PR's position 0 (STRIP_COL_IDLE) should equal main's position 1 (per direction)
for (const sprite of SWAPPED_SPRITES) {
  for (const [dir, origin] of Object.entries(DIRECTION_ORIGINS)) {
    test(`${sprite} ${dir}: PR pos ${STRIP_COL_IDLE} = main pos ${STRIP_COL_WALK1}`, () => {
      const currentBuffer = getCurrentSpriteBuffer(sprite);
      const mainBuffer = getMainSpriteBuffer(sprite);
      
      assert.ok(currentBuffer, `Current sprite ${sprite} not found`);
      assert.ok(mainBuffer, `Main sprite ${sprite} not found`);
      
      // PR's idle position (what renderer draws as idle)
      const prIdlePos = origin + STRIP_COL_IDLE;
      // Main's walk1 position (which should now be PR's idle after swap)
      const mainWalk1Pos = origin + STRIP_COL_WALK1;
      
      const prFrame = extractFramePixels(currentBuffer, prIdlePos);
      const mainFrame = extractFramePixels(mainBuffer, mainWalk1Pos);
      
      assert.ok(prFrame.equals(mainFrame),
        `${sprite} ${dir}: PR frame ${prIdlePos} should equal main frame ${mainWalk1Pos}`);
    });
  }
}

console.log('\n--- Metabee: idle = main\'s position 0 (no swap) ---\n');

// For Metabee (not swapped), PR's position 0 should equal main's position 0
for (const [dir, origin] of Object.entries(DIRECTION_ORIGINS)) {
  test(`metabee.png ${dir}: PR pos ${STRIP_COL_IDLE} = main pos ${STRIP_COL_IDLE}`, () => {
    const currentBuffer = getCurrentSpriteBuffer(METABEE_SPRITE);
    const mainBuffer = getMainSpriteBuffer(METABEE_SPRITE);
    
    assert.ok(currentBuffer, `Current sprite ${METABEE_SPRITE} not found`);
    assert.ok(mainBuffer, `Main sprite ${METABEE_SPRITE} not found`);
    
    const prIdlePos = origin + STRIP_COL_IDLE;
    const mainIdlePos = origin + STRIP_COL_IDLE;
    
    const prFrame = extractFramePixels(currentBuffer, prIdlePos);
    const mainFrame = extractFramePixels(mainBuffer, mainIdlePos);
    
    assert.ok(prFrame.equals(mainFrame),
      `Metabee ${dir}: PR frame ${prIdlePos} should equal main frame ${mainIdlePos}`);
  });
}

console.log('\n--- STRIP_COL constant verification ---\n');

test('STRIP_COL_IDLE is 0', () => {
  assert.strictEqual(STRIP_COL_IDLE, 0, 'STRIP_COL_IDLE should be 0');
});

test('STRIP_COL_WALK1 is 1', () => {
  assert.strictEqual(STRIP_COL_WALK1, 1, 'STRIP_COL_WALK1 should be 1');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
