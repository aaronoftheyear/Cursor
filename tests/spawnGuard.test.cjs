#!/usr/bin/env node
/**
 * Tests for the spawn guard - agents without spawn points should be placed on walkable tiles.
 * Uses the real spawnGuard module with real and synthetic collision maps.
 *
 * Run with: node tests/spawnGuard.test.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

console.log('\n=== Spawn Guard Tests ===\n');

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

// Import real spawnGuard module using tsx
const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
const modulePath = path.resolve(__dirname, '../src/spawnGuard.ts');

function callSpawnGuard(fnName, ...args) {
  const argsJson = args.map(a => JSON.stringify(a)).join(', ');
  const code = `
    const m = require('${modulePath.replace(/\\/g, '\\\\')}');
    console.log(JSON.stringify(m.${fnName}(${argsJson})));
  `;
  try {
    const result = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });
    return JSON.parse(result.trim());
  } catch (e) {
    throw new Error(`Failed to call ${fnName}: ${e.message}`);
  }
}

// Verify module loads
try {
  const verifyCode = `
    const m = require('${modulePath.replace(/\\/g, '\\\\')}');
    console.log(JSON.stringify({
      hasIsBlocked: typeof m.isBlocked === 'function',
      hasResolveNoSpawnTile: typeof m.resolveNoSpawnTile === 'function',
      hasIsValidSpawnPosition: typeof m.isValidSpawnPosition === 'function',
    }));
  `;
  const verifyResult = execSync(`"${tsxPath}" -e "${verifyCode.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    encoding: 'utf-8',
    cwd: path.resolve(__dirname, '..'),
  });
  const verification = JSON.parse(verifyResult.trim());
  if (!verification.hasIsBlocked || !verification.hasResolveNoSpawnTile || !verification.hasIsValidSpawnPosition) {
    throw new Error('Missing expected exports');
  }
  console.log('✓ Successfully imported real spawnGuard module\n');
} catch (e) {
  console.error('FATAL: Failed to import src/spawnGuard.ts');
  console.error('Error:', e.message);
  process.exit(1);
}

console.log('--- Small Map Tests ---\n');

// Create a small 5x4 test map:
// Row 0: blocked (top wall)
// Row 1: walkable interior
// Row 2: walkable interior
// Row 3: blocked (bottom row - should never spawn here)
const smallMap = {
  width: 5,
  height: 4,
  blocked: [
    1, 1, 1, 1, 1,  // row 0: all blocked
    1, 0, 0, 0, 1,  // row 1: edges blocked, interior walkable
    1, 0, 0, 0, 1,  // row 2: edges blocked, interior walkable
    1, 1, 1, 1, 1,  // row 3: all blocked (bottom row)
  ],
};

const smallRoom = { x: 1, y: 0, width: 3, height: 4 };
const bottomRow = 3;

test('isBlocked: returns true for blocked tiles', () => {
  assert.strictEqual(callSpawnGuard('isBlocked', smallMap, 0, 0), true, 'Corner should be blocked');
  assert.strictEqual(callSpawnGuard('isBlocked', smallMap, 2, 3), true, 'Bottom row should be blocked');
});

test('isBlocked: returns false for walkable tiles', () => {
  assert.strictEqual(callSpawnGuard('isBlocked', smallMap, 1, 1), false, 'Interior should be walkable');
  assert.strictEqual(callSpawnGuard('isBlocked', smallMap, 2, 2), false, 'Interior should be walkable');
});

test('isBlocked: returns true for out-of-bounds', () => {
  assert.strictEqual(callSpawnGuard('isBlocked', smallMap, -1, 0), true, 'Negative X should be blocked');
  assert.strictEqual(callSpawnGuard('isBlocked', smallMap, 10, 1), true, 'Beyond width should be blocked');
});

test('getWalkableTilesInRoom: returns only walkable tiles in room', () => {
  const tiles = callSpawnGuard('getWalkableTilesInRoom', smallMap, smallRoom);
  assert.ok(Array.isArray(tiles), 'Should return array');
  assert.strictEqual(tiles.length, 6, 'Should have 6 walkable tiles (3 wide x 2 high, skipping top row of room)');
  
  // All tiles should be walkable
  for (const tile of tiles) {
    assert.ok(!callSpawnGuard('isBlocked', smallMap, tile.x, tile.y), 
      `Tile (${tile.x}, ${tile.y}) should be walkable`);
  }
});

test('getAllWalkableTiles: returns all walkable tiles', () => {
  const tiles = callSpawnGuard('getAllWalkableTiles', smallMap);
  assert.strictEqual(tiles.length, 6, 'Should have 6 walkable tiles in small map');
});

test('resolveNoSpawnTile: never returns blocked tile', () => {
  // Run multiple times to test randomness
  for (let i = 0; i < 20; i++) {
    const tile = callSpawnGuard('resolveNoSpawnTile', smallMap, smallRoom, bottomRow);
    assert.ok(tile, 'Should return a tile');
    assert.ok(!callSpawnGuard('isBlocked', smallMap, tile.x, tile.y),
      `Tile (${tile.x}, ${tile.y}) should not be blocked`);
  }
});

test('resolveNoSpawnTile: never returns bottom row', () => {
  // Run multiple times to test randomness
  for (let i = 0; i < 20; i++) {
    const tile = callSpawnGuard('resolveNoSpawnTile', smallMap, smallRoom, bottomRow);
    assert.ok(tile, 'Should return a tile');
    assert.notStrictEqual(tile.y, bottomRow, 
      `Tile (${tile.x}, ${tile.y}) should not be on bottom row ${bottomRow}`);
  }
});

test('resolveNoSpawnTile: prefers room tiles when available', () => {
  // With a room that has walkable tiles, it should pick from room
  const tile = callSpawnGuard('resolveNoSpawnTile', smallMap, smallRoom, bottomRow);
  assert.ok(tile, 'Should return a tile');
  
  // Tile should be within room bounds (excluding top row of room which is blocked anyway)
  const inRoom = tile.x >= smallRoom.x && tile.x < smallRoom.x + smallRoom.width &&
                 tile.y > smallRoom.y && tile.y < smallRoom.y + smallRoom.height;
  assert.ok(inRoom, `Tile (${tile.x}, ${tile.y}) should be in room`);
});

test('isValidSpawnPosition: rejects blocked tiles', () => {
  const result = callSpawnGuard('isValidSpawnPosition', smallMap, { x: 0, y: 0 }, bottomRow);
  assert.strictEqual(result.valid, false, 'Should reject blocked tile');
  assert.ok(result.reason.includes('blocked'), 'Reason should mention blocked');
});

test('isValidSpawnPosition: rejects bottom row', () => {
  // Even if we artificially say the tile is walkable, bottom row should fail
  const unblockBottomMap = { ...smallMap, blocked: [...smallMap.blocked] };
  unblockBottomMap.blocked[bottomRow * smallMap.width + 2] = 0; // Make (2,3) walkable
  
  const result = callSpawnGuard('isValidSpawnPosition', unblockBottomMap, { x: 2, y: 3 }, bottomRow);
  assert.strictEqual(result.valid, false, 'Should reject bottom row tile');
  assert.ok(result.reason.includes('bottom row'), 'Reason should mention bottom row');
});

test('isValidSpawnPosition: accepts valid tiles', () => {
  const result = callSpawnGuard('isValidSpawnPosition', smallMap, { x: 2, y: 1 }, bottomRow);
  assert.strictEqual(result.valid, true, 'Should accept valid tile');
});

console.log('\n--- Real Collision Map Tests ---\n');

const collisionPath = path.resolve(__dirname, '../public/assets/maps/dashboard-v1-collision.json');
const collision = JSON.parse(fs.readFileSync(collisionPath, 'utf-8'));
const realBottomRow = collision.height - 1;

test('Real map: bottom row is fully blocked', () => {
  for (let x = 0; x < collision.width; x++) {
    assert.ok(callSpawnGuard('isBlocked', collision, x, realBottomRow),
      `Tile (${x}, ${realBottomRow}) should be blocked`);
  }
});

test('Real map: edge columns are blocked', () => {
  for (let y = 0; y < collision.height; y++) {
    assert.ok(callSpawnGuard('isBlocked', collision, 0, y), `Tile (0, ${y}) should be blocked`);
    assert.ok(callSpawnGuard('isBlocked', collision, collision.width - 1, y),
      `Tile (${collision.width - 1}, ${y}) should be blocked`);
  }
});

test('Real map: resolveNoSpawnTile never returns bottom row', () => {
  const testRoom = { x: 5, y: 3, width: 10, height: 8 };
  for (let i = 0; i < 20; i++) {
    const tile = callSpawnGuard('resolveNoSpawnTile', collision, testRoom, realBottomRow);
    if (tile) {
      assert.notStrictEqual(tile.y, realBottomRow,
        `Tile (${tile.x}, ${tile.y}) should not be on bottom row ${realBottomRow}`);
    }
  }
});

test('Real map: all walkable tiles pass validation', () => {
  const walkable = callSpawnGuard('getAllWalkableTiles', collision);
  for (const tile of walkable.slice(0, 50)) { // Test first 50 for speed
    const result = callSpawnGuard('isValidSpawnPosition', collision, tile, realBottomRow);
    assert.ok(result.valid, `Walkable tile (${tile.x}, ${tile.y}) should pass validation`);
  }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
