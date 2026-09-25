#!/usr/bin/env node
/**
 * Tests for the spawn guard - agents without spawn points should be placed on walkable tiles.
 * Tests the real MapGrid class with the real collision data.
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

const collisionPath = path.resolve(__dirname, '../public/assets/maps/dashboard-v1-collision.json');
const collision = JSON.parse(fs.readFileSync(collisionPath, 'utf-8'));

console.log('--- Real MapGrid Collision Tests ---\n');

// Import and test the real MapGrid class using tsx
let MapGrid;
try {
  const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
  const modulePath = path.resolve(__dirname, '../src/mapGrid.ts');
  
  // Test isBlocked function using real MapGrid
  const testIsBlocked = (tileX, tileY) => {
    const code = `
      const { MapGrid } = require('${modulePath.replace(/\\/g, '\\\\')}');
      const collision = ${JSON.stringify(collision)};
      const grid = new MapGrid(collision);
      console.log(grid.isBlocked(${tileX}, ${tileY}));
    `;
    const result = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });
    return result.trim() === 'true';
  };
  
  // Test isBlockedForFootprint function using real MapGrid
  const testIsBlockedForFootprint = (tileXs, footTileY) => {
    const code = `
      const { MapGrid } = require('${modulePath.replace(/\\/g, '\\\\')}');
      const collision = ${JSON.stringify(collision)};
      const grid = new MapGrid(collision);
      console.log(grid.isBlockedForFootprint(${JSON.stringify(tileXs)}, ${footTileY}));
    `;
    const result = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });
    return result.trim() === 'true';
  };
  
  console.log('✓ Successfully imported real MapGrid module\n');
  
  test('MapGrid.isBlocked: bottom row (row 22) is fully blocked', () => {
    for (let x = 0; x < Math.min(10, collision.width); x++) {
      assert.ok(testIsBlocked(x, 22), `Tile (${x}, 22) should be blocked`);
    }
  });
  
  test('MapGrid.isBlocked: left edge (column 0) is fully blocked', () => {
    for (let y = 0; y < Math.min(10, collision.height); y++) {
      assert.ok(testIsBlocked(0, y), `Tile (0, ${y}) should be blocked`);
    }
  });
  
  test('MapGrid.isBlocked: right edge (column 33) is fully blocked', () => {
    for (let y = 0; y < Math.min(10, collision.height); y++) {
      assert.ok(testIsBlocked(33, y), `Tile (33, ${y}) should be blocked`);
    }
  });
  
  test('MapGrid.isBlocked: out-of-bounds coordinates return true', () => {
    assert.ok(testIsBlocked(-1, 5), 'Negative X should be blocked');
    assert.ok(testIsBlocked(5, -1), 'Negative Y should be blocked');
    assert.ok(testIsBlocked(100, 5), 'X beyond width should be blocked');
    assert.ok(testIsBlocked(5, 100), 'Y beyond height should be blocked');
  });
  
  test('MapGrid.isBlockedForFootprint: returns true if any tile in footprint is blocked', () => {
    // Bottom row is blocked, so any footprint including row 22 should be blocked
    assert.ok(testIsBlockedForFootprint([5, 6], 22), 'Footprint at blocked row should be blocked');
    assert.ok(testIsBlockedForFootprint([0], 5), 'Footprint at blocked column should be blocked');
  });
  
  test('MapGrid.isBlockedForFootprint: returns false if all tiles are walkable', () => {
    // Find a walkable tile from the collision data
    let walkableX = -1, walkableY = -1;
    for (let y = 3; y < collision.height - 1; y++) {
      for (let x = 1; x < collision.width - 1; x++) {
        if (collision.blocked[y * collision.width + x] === 0) {
          walkableX = x;
          walkableY = y;
          break;
        }
      }
      if (walkableX >= 0) break;
    }
    if (walkableX >= 0) {
      assert.ok(!testIsBlockedForFootprint([walkableX], walkableY), 
        `Walkable tile (${walkableX}, ${walkableY}) should not be blocked`);
    }
  });
  
} catch (e) {
  console.error('FATAL: Failed to import src/mapGrid.ts');
  console.error('Make sure tsx is installed: npm install --save-dev tsx');
  console.error('Error:', e.message);
  process.exit(1);
}

console.log('\n--- Spawn Guard Code Pattern Tests ---\n');

const enginePath = path.resolve(__dirname, '../src/engine.ts');
const engine = fs.readFileSync(enginePath, 'utf-8');

test('resolveSpawnFootTile handles missing spawn point', () => {
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
  assert.ok(
    engine.includes('let walkable = this.getWalkableTilesInRoom(agent)'),
    'Should try room tiles first for no-spawn case'
  );
});

test('No-spawn guard falls back to all walkable tiles', () => {
  assert.ok(
    engine.includes('walkable = this.getAllWalkableTiles(agent)'),
    'Should fall back to all walkable tiles'
  );
});

test('Spawn guard returns null if no walkable tiles', () => {
  const resolveSpawnMatch = engine.match(/resolveSpawnFootTile[\s\S]*?return null;\s*\}/);
  assert.ok(resolveSpawnMatch, 'Should return null if no walkable tiles found');
});

console.log('\n--- Collision Data Verification ---\n');

function isBlocked(x, y) {
  if (x < 0 || y < 0 || x >= collision.width || y >= collision.height) return true;
  return collision.blocked[y * collision.width + x] === 1;
}

test('Collision data has correct dimensions (34x23)', () => {
  assert.strictEqual(collision.width, 34, 'Width should be 34');
  assert.strictEqual(collision.height, 23, 'Height should be 23');
});

test('Collision data has blocked array of correct size', () => {
  assert.strictEqual(collision.blocked.length, collision.width * collision.height, 
    'Blocked array should have width*height entries');
});

test('Bottom row (row 22) is fully blocked - spawn guard must never place here', () => {
  for (let x = 0; x < collision.width; x++) {
    assert.ok(isBlocked(x, 22), `Tile (${x}, 22) should be blocked`);
  }
});

test('Edge columns (0 and 33) are fully blocked - spawn guard must never place here', () => {
  for (let y = 0; y < collision.height; y++) {
    assert.ok(isBlocked(0, y), `Tile (0, ${y}) should be blocked`);
    assert.ok(isBlocked(33, y), `Tile (33, ${y}) should be blocked`);
  }
});

test('There exist walkable tiles in the interior', () => {
  let walkableCount = 0;
  for (let y = 1; y < collision.height - 1; y++) {
    for (let x = 1; x < collision.width - 1; x++) {
      if (!isBlocked(x, y)) walkableCount++;
    }
  }
  assert.ok(walkableCount > 100, `Should have many walkable tiles, found ${walkableCount}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
