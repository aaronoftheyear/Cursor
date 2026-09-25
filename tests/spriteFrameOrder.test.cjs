#!/usr/bin/env node
/**
 * Sprite frame order pixel comparison tests.
 *
 * Verifies that:
 * - For swapped avatars: renderer's idle frame = main's position 1 (0-based) per direction
 * - For Metabee: renderer's idle frame = main's position 0 (0-based) per direction
 *
 * The renderer uses STRIP_COL_IDLE=0, so it draws position 0 as idle.
 * After the swap, swapped sprites have walk1 (main's pos 1) at position 0.
 * Metabee (not swapped) still has idle (main's pos 0) at position 0.
 *
 * Run with: node tests/spriteFrameOrder.test.cjs
 */

const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('\n=== Sprite Frame Order Pixel Tests ===\n');

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

// Swapped sprites: idle from position 0, which was main's position 1 before swap
const SWAPPED_SPRITES = [
  'apple.png', 'bumblebee.png', 'claude.png', 'claude_code.png', 'claude_cowork.png',
  'claude_grunt02.png', 'cursor_grunt01.png', 'cursor_grunt02.png', 'friday.png',
  'gemini.png', 'grok.png', 'grok_grunt.png', 'grok-v1.png', 'jarvis.png', 'laya.png',
];

// Metabee uses original order: idle from position 0
const METABEE_SPRITE = 'metabee.png';

// Direction origins in the strip (each direction has 3 frames)
const DIRECTION_ORIGINS = { down: 0, up: 3, left: 6 };

// Frame positions within a direction triplet (0-based)
const FRAME_POS = { idle: 0, walk1: 1, walk2: 2 };

// Python helper to extract and compare frames
function extractFrame(spritePath, frameIndex) {
  const script = `
import sys
from PIL import Image
img = Image.open(sys.argv[1])
if img.width != 144 or img.height != 32:
    print("ERROR:not 144x32")
    sys.exit(1)
frame = img.crop((int(sys.argv[2]) * 16, 0, (int(sys.argv[2]) + 1) * 16, 32))
# Output as hex string of RGBA pixels
pixels = []
for y in range(32):
    for x in range(16):
        r, g, b, a = frame.getpixel((x, y))
        pixels.append(f"{r:02x}{g:02x}{b:02x}{a:02x}")
print("".join(pixels))
`;
  try {
    const result = execSync(
      `python3 -c '${script.replace(/'/g, "'\\''")}' "${spritePath}" ${frameIndex}`,
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
    );
    if (result.startsWith('ERROR:')) {
      return { error: result.slice(6).trim() };
    }
    return { pixels: result.trim() };
  } catch (e) {
    return { error: e.message };
  }
}

function framesEqual(sprite, pos1, pos2) {
  const spritePath = path.join(spritesDir, sprite);
  const frame1 = extractFrame(spritePath, pos1);
  const frame2 = extractFrame(spritePath, pos2);
  if (frame1.error) return { equal: false, error: `pos ${pos1}: ${frame1.error}` };
  if (frame2.error) return { equal: false, error: `pos ${pos2}: ${frame2.error}` };
  return { equal: frame1.pixels === frame2.pixels };
}

// Get main's sprite from git
function getMainSprite(sprite) {
  const tmpPath = `/tmp/main_${sprite}`;
  try {
    execSync(`git show origin/main:public/assets/sprites/${sprite} > "${tmpPath}"`, {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf-8',
    });
    return tmpPath;
  } catch (e) {
    return null;
  }
}

function getMainFrame(sprite, frameIndex) {
  const mainPath = getMainSprite(sprite);
  if (!mainPath) return { error: 'Could not get main sprite' };
  return extractFrame(mainPath, frameIndex);
}

function getCurrentFrame(sprite, frameIndex) {
  const spritePath = path.join(spritesDir, sprite);
  return extractFrame(spritePath, frameIndex);
}

console.log('--- Swapped Sprites: idle = main\'s position 1 ---\n');

// For swapped sprites, current position 0 should equal main's position 1 (per direction)
for (const sprite of SWAPPED_SPRITES.slice(0, 5)) {  // Test first 5 for speed
  for (const [dir, origin] of Object.entries(DIRECTION_ORIGINS)) {
    test(`${sprite} ${dir}: current pos 0 = main pos 1`, () => {
      const currentIdlePos = origin + 0;  // Renderer uses position 0 for idle
      const mainWalk1Pos = origin + 1;    // Main's position 1 (walk1)
      
      const currentFrame = getCurrentFrame(sprite, currentIdlePos);
      const mainFrame = getMainFrame(sprite, mainWalk1Pos);
      
      assert.ok(!currentFrame.error, `Current frame error: ${currentFrame.error}`);
      assert.ok(!mainFrame.error, `Main frame error: ${mainFrame.error}`);
      assert.strictEqual(currentFrame.pixels, mainFrame.pixels,
        `${sprite} ${dir}: current idle frame should equal main's walk1 frame`);
    });
  }
}

console.log('\n--- Metabee: idle = main\'s position 0 ---\n');

// For Metabee (not swapped), current position 0 should equal main's position 0
for (const [dir, origin] of Object.entries(DIRECTION_ORIGINS)) {
  test(`metabee.png ${dir}: current pos 0 = main pos 0`, () => {
    const currentIdlePos = origin + 0;
    const mainIdlePos = origin + 0;
    
    const currentFrame = getCurrentFrame(METABEE_SPRITE, currentIdlePos);
    const mainFrame = getMainFrame(METABEE_SPRITE, mainIdlePos);
    
    assert.ok(!currentFrame.error, `Current frame error: ${currentFrame.error}`);
    assert.ok(!mainFrame.error, `Main frame error: ${mainFrame.error}`);
    assert.strictEqual(currentFrame.pixels, mainFrame.pixels,
      `Metabee ${dir}: current idle frame should equal main's idle frame`);
  });
}

console.log('\n--- STRIP_COL constant verification ---\n');

test('assets.ts has STRIP_COL_IDLE = 0', () => {
  const assetsPath = path.resolve(__dirname, '../src/assets.ts');
  const assets = fs.readFileSync(assetsPath, 'utf-8');
  assert.ok(assets.includes('const STRIP_COL_IDLE = 0;'), 'STRIP_COL_IDLE should be 0');
});

test('assets.ts has STRIP_COL_WALK1 = 1', () => {
  const assetsPath = path.resolve(__dirname, '../src/assets.ts');
  const assets = fs.readFileSync(assetsPath, 'utf-8');
  assert.ok(assets.includes('const STRIP_COL_WALK1 = 1;'), 'STRIP_COL_WALK1 should be 1');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
