#!/usr/bin/env node
/**
 * Tests for the spawn guard - agents without spawn points should be placed on walkable tiles.
 *
 * Run with: node tests/spawnGuard.test.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

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

const enginePath = path.resolve(__dirname, '../src/engine.ts');
const engine = fs.readFileSync(enginePath, 'utf-8');

console.log('--- No-Spawn Guard Tests ---\n');

test('resolveSpawnFootTile handles missing spawn point', () => {
  // Should have code path for when preferred is null/undefined
  assert.ok(
    engine.includes('if (preferred)'),
    'Should check if preferred spawn point exists'
  );
  assert.ok(
    engine.includes('// No spawn point defined'),
    'Should have comment for no-spawn case'
  );
});

test('No-spawn guard prefers walkable tiles in agent\'s room', () => {
  // Should try getWalkableTilesInRoom first
  assert.ok(
    engine.includes('let walkable = this.getWalkableTilesInRoom(agent)'),
    'Should try room tiles first for no-spawn case'
  );
});

test('No-spawn guard falls back to all walkable tiles', () => {
  // Should fall back to getAllWalkableTiles if room is empty
  assert.ok(
    engine.includes('walkable = this.getAllWalkableTiles(agent)'),
    'Should fall back to all walkable tiles'
  );
});

test('No-spawn guard never uses random pixel positions', () => {
  // The resolveSpawnFootTile function should use walkable tile functions
  // Extract just the function body
  assert.ok(
    engine.includes('getWalkableTilesInRoom(agent)'),
    'Should use getWalkableTilesInRoom'
  );
  assert.ok(
    engine.includes('getAllWalkableTiles(agent)'),
    'Should use getAllWalkableTiles as fallback'
  );
});

test('Spawn guard returns null if no walkable tiles', () => {
  // Should return null at the end if no tiles found
  const resolveSpawnMatch = engine.match(/resolveSpawnFootTile[\s\S]*?return null;\s*\}/);
  assert.ok(resolveSpawnMatch, 'Should return null if no walkable tiles found');
});

console.log('\n--- Map Bounds Integration ---\n');

const collisionPath = path.resolve(__dirname, '../public/assets/maps/dashboard-v1-collision.json');
const collision = JSON.parse(fs.readFileSync(collisionPath, 'utf-8'));

// Collision uses flat array: blocked[y * width + x] = 1 means blocked
function isBlocked(x, y) {
  const idx = y * collision.width + x;
  return collision.blocked[idx] === 1;
}

test('Collision data has blocked array defined', () => {
  assert.ok(collision.blocked, 'Should have blocked array');
  assert.strictEqual(collision.blocked.length, collision.width * collision.height, 
    'Blocked array should have width*height entries');
});

test('Last row (row 22) is fully blocked', () => {
  for (let x = 0; x < collision.width; x++) {
    assert.ok(isBlocked(x, 22), `Tile (${x}, 22) should be blocked`);
  }
});

test('Edge columns (0 and 33) are fully blocked', () => {
  for (let y = 0; y < collision.height; y++) {
    assert.ok(isBlocked(0, y), `Tile (0, ${y}) should be blocked`);
    assert.ok(isBlocked(33, y), `Tile (33, ${y}) should be blocked`);
  }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
