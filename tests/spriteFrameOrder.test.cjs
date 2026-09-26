#!/usr/bin/env node
/**
 * Sprite frame order tests using Node.js PNG decoding (pngjs).
 *
 * Swapped avatars: PR strip index 0 (idle) = main branch strip index 1.
 * Grok: PR strip index 0 = idle from original sheet column 2 (3rd sprite), after reorder.
 * Metabee: PR index 0 = main index 0 (no swap).
 *
 * Main-branch sprites are read from tests/fixtures/main-branch-sprites/ so tests
 * do not silently skip when origin/main is unavailable.
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
const fixturesDir = path.resolve(__dirname, 'fixtures/main-branch-sprites');
const originalsDir = path.resolve(__dirname, '../public/assets/sprites/originals');

const SWAPPED_SPRITES = [
  'apple.png', 'claude.png', 'claude_grunt02.png', 'cursor_grunt01.png', 'cursor_grunt02.png',
  'friday.png', 'grok_grunt.png', 'grok-v1.png', 'laya.png',
];

const BUMBLEBEE_SPRITE = 'bumblebee.png';

const GROK_IDLE_SPRITE = 'grok.png';
const METABEE_SPRITE = 'metabee.png';

/** Round-10 re-conversion changes pixels but keeps frame order; compare via pipeline, not main. */
const RECONVERTED_PIPELINE = {
  'jarvis.png': {
    sheet: 'public/assets/sprites/sheets/cursor-jarvis-v2.png',
    idleCol: 1,
    kind: 'rpg',
  },
  'gemini.png': { sheet: 'public/assets/sprites/sheets/gemini.png', idleCol: 1, kind: 'rpg' },
  'claude.png': { sheet: 'public/assets/sprites/sheets/claude-grunt01.png', idleCol: 1, kind: 'rpg' },
  'claude_cowork.png': {
    sheet: 'public/assets/sprites/sheets/claude-cowork.png',
    idleCol: 1,
    kind: 'rpg',
  },
  'claude_code.png': {
    sheet: 'public/assets/sprites/sheets/cluade-code.png',
    idleCol: 1,
    kind: 'rpg',
  },
};

const DIRECTION_ORIGINS = { down: 0, up: 3, left: 6 };

let STRIP_COL_IDLE, STRIP_COL_WALK1;
try {
  const result = execSync(
    `npx tsx -e "import { STRIP_COL_IDLE, STRIP_COL_WALK1 } from './src/assets'; console.log(JSON.stringify({ STRIP_COL_IDLE, STRIP_COL_WALK1 }))"`,
    {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf-8',
    }
  );
  const constants = JSON.parse(result.trim());
  STRIP_COL_IDLE = constants.STRIP_COL_IDLE;
  STRIP_COL_WALK1 = constants.STRIP_COL_WALK1;
  console.log(`✓ Imported STRIP_COL_IDLE=${STRIP_COL_IDLE}, STRIP_COL_WALK1=${STRIP_COL_WALK1}\n`);
} catch (e) {
  console.error('FATAL: Failed to import STRIP_COL constants from assets.ts');
  console.error('Error:', e.message);
  process.exit(1);
}

function extractFramePixels(pngBuffer, frameIndex) {
  const png = PNG.sync.read(pngBuffer);
  if (png.width !== 144 || png.height !== 32) {
    throw new Error(`Expected 144x32, got ${png.width}x${png.height}`);
  }

  const frameX = frameIndex * 16;
  const pixels = [];

  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = (y * png.width + (frameX + x)) * 4;
      pixels.push(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]);
    }
  }

  return Buffer.from(pixels);
}

function getMainSpriteBuffer(sprite) {
  const fixturePath = path.join(fixturesDir, sprite);
  if (fs.existsSync(fixturePath)) {
    return fs.readFileSync(fixturePath);
  }
  try {
    return execSync(`git show origin/main:public/assets/sprites/${sprite}`, {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(
      `Missing main sprite fixture for ${sprite} (expected ${fixturePath}). ` +
        'Commit fixtures or fetch origin/main.'
    );
  }
}

function getCurrentSpriteBuffer(sprite) {
  const spritePath = path.join(spritesDir, sprite);
  if (!fs.existsSync(spritePath)) return null;
  return fs.readFileSync(spritePath);
}

function buildGrokExpectedStrip() {
  const original = path.join(originalsDir, 'grok-v2.png');
  const tmpStrip = path.join(__dirname, '../.tmp-screenshots/grok-expected-strip.png');
  const tmpFinal = path.join(__dirname, '../.tmp-screenshots/grok-expected-final.png');
  fs.mkdirSync(path.dirname(tmpStrip), { recursive: true });
  execSync(
    `python3 scripts/convert-sprite-sheet.py "${original}" "${tmpStrip}" --idle-col 2`,
    { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' }
  );
  execSync(`python3 scripts/reorder-strip-frames.py "${tmpStrip}" "${tmpFinal}"`, {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'pipe',
  });
  return fs.readFileSync(tmpFinal);
}

function buildRpgPipelineExpectedStrip(spriteName, reorder = true) {
  const spec = RECONVERTED_PIPELINE[spriteName];
  const root = path.resolve(__dirname, '..');
  const sheetPath = path.join(root, spec.sheet);
  const tmpStrip = path.join(__dirname, `../.tmp-screenshots/${spriteName}-expected-strip.png`);
  const tmpFinal = path.join(__dirname, `../.tmp-screenshots/${spriteName}-expected-final.png`);
  fs.mkdirSync(path.dirname(tmpStrip), { recursive: true });
  execSync(
    `python3 scripts/convert-rpg-sheet.py "${sheetPath}" "${tmpStrip}" --idle-col ${spec.idleCol}`,
    { cwd: root, stdio: 'pipe' }
  );
  if (reorder) {
    execSync(`python3 scripts/reorder-strip-frames.py "${tmpStrip}" "${tmpFinal}"`, {
      cwd: root,
      stdio: 'pipe',
    });
  } else {
    fs.copyFileSync(tmpStrip, tmpFinal);
  }
  return fs.readFileSync(tmpFinal);
}

test('main-branch sprite fixtures are present', () => {
  const required = ['jarvis.png', 'friday.png', 'grok.png', METABEE_SPRITE];
  for (const sprite of required) {
    const p = path.join(fixturesDir, sprite);
    assert.ok(fs.existsSync(p), `Missing fixture ${p}`);
  }
});

console.log('--- Swapped sprites: idle = main position 1 ---\n');

const SWAPPED_COMPARE_MAIN = SWAPPED_SPRITES.filter((s) => !(s in RECONVERTED_PIPELINE));

for (const sprite of SWAPPED_COMPARE_MAIN) {
  for (const [dir, origin] of Object.entries(DIRECTION_ORIGINS)) {
    const mainCol = dir === 'left' ? STRIP_COL_IDLE : STRIP_COL_WALK1;
    const mainColLabel = dir === 'left' ? 'idle' : 'walk1';
    test(`${sprite} ${dir}: PR pos ${STRIP_COL_IDLE} = main pos ${mainCol} (${mainColLabel})`, () => {
      const currentBuffer = getCurrentSpriteBuffer(sprite);
      assert.ok(currentBuffer, `Current sprite ${sprite} not found`);

      const mainBuffer = getMainSpriteBuffer(sprite);
      const prIdlePos = origin + STRIP_COL_IDLE;
      const mainComparePos = origin + mainCol;

      const prFrame = extractFramePixels(currentBuffer, prIdlePos);
      const mainFrame = extractFramePixels(mainBuffer, mainComparePos);

      assert.ok(
        prFrame.equals(mainFrame),
        `${sprite} ${dir}: PR frame ${prIdlePos} should equal main frame ${mainComparePos}`
      );
    });
  }
}

console.log('\n--- Re-converted RPG sheets: idle matches uniform-scale pipeline ---\n');

for (const sprite of Object.keys(RECONVERTED_PIPELINE)) {
  const expectedBuffer = buildRpgPipelineExpectedStrip(sprite);
  for (const [dir, origin] of Object.entries(DIRECTION_ORIGINS)) {
    test(`${sprite} ${dir}: PR idle matches re-convert pipeline`, () => {
      const currentBuffer = getCurrentSpriteBuffer(sprite);
      assert.ok(currentBuffer, `Missing ${sprite}`);
      const prIdlePos = origin + STRIP_COL_IDLE;
      const prFrame = extractFramePixels(currentBuffer, prIdlePos);
      const expectedFrame = extractFramePixels(expectedBuffer, prIdlePos);
      assert.ok(
        prFrame.equals(expectedFrame),
        `${sprite} ${dir}: idle must match convert-rpg-sheet + reorder pipeline`
      );
    });
  }
}

console.log('\n--- Grok: idle = 3rd sprite of original sheet (idle-col 2 + reorder) ---\n');

for (const [dir, origin] of Object.entries(DIRECTION_ORIGINS)) {
  test(`${GROK_IDLE_SPRITE} ${dir}: PR idle matches original-sheet column 2 pipeline`, () => {
    const currentBuffer = getCurrentSpriteBuffer(GROK_IDLE_SPRITE);
    assert.ok(currentBuffer, `Missing ${GROK_IDLE_SPRITE}`);
    const expectedBuffer = buildGrokExpectedStrip();
    const prIdlePos = origin + STRIP_COL_IDLE;
    const prFrame = extractFramePixels(currentBuffer, prIdlePos);
    const expectedFrame = extractFramePixels(expectedBuffer, prIdlePos);
    assert.ok(
      prFrame.equals(expectedFrame),
      `${GROK_IDLE_SPRITE} ${dir}: idle frame must match --idle-col 2 + reorder pipeline`
    );
  });
}

console.log('\n--- Bumblebee: byte-identical to main (123456789, do not re-convert) ---\n');

test(`${BUMBLEBEE_SPRITE}: PR file matches main-branch fixture bytes`, () => {
  const currentBuffer = getCurrentSpriteBuffer(BUMBLEBEE_SPRITE);
  assert.ok(currentBuffer, `Missing ${BUMBLEBEE_SPRITE}`);
  const mainBuffer = getMainSpriteBuffer(BUMBLEBEE_SPRITE);
  assert.ok(
    currentBuffer.equals(mainBuffer),
    `${BUMBLEBEE_SPRITE} must be byte-identical to origin/main (no re-convert on PR #3)`
  );
});

console.log('\n--- Metabee: idle = main position 0 (no swap) ---\n');

for (const [dir, origin] of Object.entries(DIRECTION_ORIGINS)) {
  test(`metabee.png ${dir}: PR pos ${STRIP_COL_IDLE} = main pos ${STRIP_COL_IDLE}`, () => {
    const currentBuffer = getCurrentSpriteBuffer(METABEE_SPRITE);
    assert.ok(currentBuffer, `Current sprite ${METABEE_SPRITE} not found`);

    const mainBuffer = getMainSpriteBuffer(METABEE_SPRITE);
    const prIdlePos = origin + STRIP_COL_IDLE;
    const mainIdlePos = origin + STRIP_COL_IDLE;

    const prFrame = extractFramePixels(currentBuffer, prIdlePos);
    const mainFrame = extractFramePixels(mainBuffer, mainIdlePos);

    assert.ok(
      prFrame.equals(mainFrame),
      `Metabee ${dir}: PR frame ${prIdlePos} should equal main frame ${mainIdlePos}`
    );
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
