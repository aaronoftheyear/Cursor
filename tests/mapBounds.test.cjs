/**
 * Tests for map bounds and collision enforcement.
 * Verifies that agents cannot walk on blocked tiles (edges, walls, etc).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('\n=== Map Bounds Tests ===\n');

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

// Load map configuration
const hqJsonPath = path.join(__dirname, '../public/assets/maps/hq.json');
const collisionJsonPath = path.join(__dirname, '../public/assets/maps/dashboard-v1-collision.json');

let hqData, collisionData;

try {
  hqData = JSON.parse(fs.readFileSync(hqJsonPath, 'utf8'));
  collisionData = JSON.parse(fs.readFileSync(collisionJsonPath, 'utf8'));
} catch (e) {
  console.error('Failed to load map data:', e.message);
  process.exit(1);
}

const { width, height, blocked } = collisionData;

function isBlocked(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return true;
  return blocked[y * width + x] === 1;
}

console.log('--- Map Edge Tests ---\n');

test('Last row (row 22) is fully blocked', () => {
  const lastRow = height - 1;
  for (let x = 0; x < width; x++) {
    assert.ok(isBlocked(x, lastRow), `Tile (${x}, ${lastRow}) should be blocked`);
  }
});

test('First row (row 0) is fully blocked', () => {
  for (let x = 0; x < width; x++) {
    assert.ok(isBlocked(x, 0), `Tile (${x}, 0) should be blocked`);
  }
});

test('Left edge (column 0) is fully blocked', () => {
  for (let y = 0; y < height; y++) {
    assert.ok(isBlocked(0, y), `Tile (0, ${y}) should be blocked`);
  }
});

test('Right edge (column 33) is fully blocked', () => {
  const lastCol = width - 1;
  for (let y = 0; y < height; y++) {
    assert.ok(isBlocked(lastCol, y), `Tile (${lastCol}, ${y}) should be blocked`);
  }
});

console.log('\n--- Agent Spawn Point Tests ---\n');

test('All agents in hq.json have spawn points', () => {
  const roomAgents = hqData.rooms.flatMap(r => r.agents || []);
  const spawnPointAgents = Object.keys(hqData.spawnPoints);
  
  for (const agentId of roomAgents) {
    assert.ok(
      spawnPointAgents.includes(agentId),
      `Agent "${agentId}" is in a room but has no spawn point`
    );
  }
});

test('Metabee has a spawn point in main-space', () => {
  const metabeeSpawn = hqData.spawnPoints.metabee;
  assert.ok(metabeeSpawn, 'Metabee should have a spawn point');
  assert.strictEqual(metabeeSpawn.room, 'main-space');
});

test('Metabee is in main-space agents list', () => {
  const mainSpace = hqData.rooms.find(r => r.id === 'main-space');
  assert.ok(mainSpace, 'main-space room should exist');
  assert.ok(mainSpace.agents.includes('metabee'), 'Metabee should be in main-space agents');
});

test('All spawn points are on walkable tiles', () => {
  for (const [agentId, spawn] of Object.entries(hqData.spawnPoints)) {
    const { x, y } = spawn;
    assert.ok(
      !isBlocked(x, y),
      `Spawn point for "${agentId}" at (${x}, ${y}) is on a blocked tile`
    );
  }
});

test('All spawn points are within map bounds', () => {
  for (const [agentId, spawn] of Object.entries(hqData.spawnPoints)) {
    const { x, y } = spawn;
    assert.ok(x >= 0 && x < width, `Spawn X for "${agentId}" out of bounds: ${x}`);
    assert.ok(y >= 0 && y < height, `Spawn Y for "${agentId}" out of bounds: ${y}`);
  }
});

console.log('\n--- Room Bounds Tests ---\n');

test('main-space room does not extend to last row', () => {
  const mainSpace = hqData.rooms.find(r => r.id === 'main-space');
  const roomBottom = mainSpace.y + mainSpace.height - 1;
  const lastRow = height - 1;
  assert.ok(
    roomBottom < lastRow,
    `main-space bottom (${roomBottom}) should be above last row (${lastRow})`
  );
});

test('All rooms are within map bounds', () => {
  for (const room of hqData.rooms) {
    const right = room.x + room.width - 1;
    const bottom = room.y + room.height - 1;
    assert.ok(room.x >= 0 && right < width, `Room "${room.id}" X out of bounds`);
    assert.ok(room.y >= 0 && bottom < height, `Room "${room.id}" Y out of bounds`);
  }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
