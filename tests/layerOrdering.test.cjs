#!/usr/bin/env node
/**
 * Layer ordering tests using the actual renderQueue module.
 *
 * Rendering order (engine.ts):
 *   PASS 1: Furniture-low (walkover) - walkable tiles drawn under avatar
 *   PASS 2: ALL SHADOWS - separate pass, always under furniture-mid/wall-front
 *   PASS 3: Depth-sorted queue: furniture-mid, avatars (NOT wall-front)
 *   PASS 4: Wall-front - ALWAYS on top of avatars and shadows
 *   PASS 5: Overlay (furniture-high) - drawn after queue
 *
 * Shadow rule: shadows are drawn BEFORE the depth-sorted queue,
 * so they are ALWAYS under furniture-mid and wall-front regardless of Y.
 *
 * Wall-front rule: wall-front is drawn AFTER the depth-sorted queue,
 * so it is ALWAYS on top of avatars and shadows regardless of Y.
 */

const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('\n=== Layer Ordering Tests ===\n');

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

// Import the real renderQueue module using tsx
let LAYER_WALKOVER, LAYER_MID, LAYER_AGENT, LAYER_WALLS_FRONT;
let buildSortedRenderQueue, sortRenderQueue;

try {
  const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
  const modulePath = path.resolve(__dirname, '../src/renderQueue.ts');
  
  // Get constants
  const constCode = `
    const m = require('${modulePath.replace(/\\/g, '\\\\')}');
    console.log(JSON.stringify({
      LAYER_WALKOVER: m.LAYER_WALKOVER,
      LAYER_MID: m.LAYER_MID,
      LAYER_AGENT: m.LAYER_AGENT,
      LAYER_WALLS_FRONT: m.LAYER_WALLS_FRONT,
    }));
  `;
  
  const constResult = execSync(`"${tsxPath}" -e "${constCode.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    encoding: 'utf-8',
    cwd: path.resolve(__dirname, '..'),
  });
  
  const constants = JSON.parse(constResult.trim());
  LAYER_WALKOVER = constants.LAYER_WALKOVER;
  LAYER_MID = constants.LAYER_MID;
  LAYER_AGENT = constants.LAYER_AGENT;
  LAYER_WALLS_FRONT = constants.LAYER_WALLS_FRONT;
  
  // Create wrapper functions that call the real module
  buildSortedRenderQueue = (agents, walkoverTiles, midTiles, wallsFrontTiles) => {
    const testCode = `
      const m = require('${modulePath.replace(/\\/g, '\\\\')}');
      const agents = ${JSON.stringify(agents.map(a => ({ id: a.id, feetY: a.feetY })))};
      const walkover = ${JSON.stringify(walkoverTiles.map(t => ({ coord: t.coord, sortY: t.sortY })))};
      const mid = ${JSON.stringify(midTiles.map(t => ({ coord: t.coord, sortY: t.sortY })))};
      const wallsFront = ${JSON.stringify(wallsFrontTiles.map(t => ({ coord: t.coord, sortY: t.sortY })))};
      
      const agentInfos = agents.map(a => ({
        id: a.id,
        feetY: a.feetY,
        drawShadow: () => {},
        drawAgent: () => {},
      }));
      const walkoverInfos = walkover.map(t => ({
        coord: t.coord,
        sortY: t.sortY,
        draw: () => {},
      }));
      const midInfos = mid.map(t => ({
        coord: t.coord,
        sortY: t.sortY,
        draw: () => {},
      }));
      const wallsFrontInfos = wallsFront.map(t => ({
        coord: t.coord,
        sortY: t.sortY,
        draw: () => {},
      }));
      
      const queue = m.buildSortedRenderQueue(agentInfos, walkoverInfos, midInfos, wallsFrontInfos);
      const result = queue.map(item => ({
        sortY: item.sortY,
        layer: item.layer,
        name: item.layer === m.LAYER_AGENT ? agents.find(a => a.feetY === item.sortY)?.id || 'agent' :
              item.layer === m.LAYER_WALKOVER ? 'walkover-' + walkover.find(t => t.sortY === item.sortY)?.coord.x + ',' + walkover.find(t => t.sortY === item.sortY)?.coord.y :
              item.layer === m.LAYER_MID ? 'mid-' + mid.find(t => t.sortY === item.sortY)?.coord.x + ',' + mid.find(t => t.sortY === item.sortY)?.coord.y :
              'walls-front-' + wallsFront.find(t => t.sortY === item.sortY)?.coord.x + ',' + wallsFront.find(t => t.sortY === item.sortY)?.coord.y,
      }));
      console.log(JSON.stringify(result));
    `;
    
    const result = execSync(`"${tsxPath}" -e "${testCode.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: path.resolve(__dirname, '..'),
    });
    
    return JSON.parse(result.trim());
  };
  
  console.log('✓ Successfully imported real renderQueue module\n');
} catch (e) {
  console.error('FATAL: Failed to import src/renderQueue.ts');
  console.error('Make sure tsx is installed: npm install --save-dev tsx');
  console.error('Error:', e.message);
  process.exit(1);
}

// Helper to create test agents
function mockAgent(id, feetY) {
  return { id, feetY };
}

// Helper to create test tiles
function mockTile(x, y, sortY) {
  return { coord: { x, y }, sortY };
}

console.log('--- Module Import Tests ---\n');

test('LAYER_WALKOVER is 0', () => {
  assert.strictEqual(LAYER_WALKOVER, 0);
});

test('LAYER_MID is 10', () => {
  assert.strictEqual(LAYER_MID, 10);
});

test('LAYER_AGENT is 20', () => {
  assert.strictEqual(LAYER_AGENT, 20);
});

test('LAYER_WALLS_FRONT is 30', () => {
  assert.strictEqual(LAYER_WALLS_FRONT, 30);
});

console.log('\n--- Depth-Sorted Queue Tests (real buildSortedRenderQueue) ---\n');

test('Agent draws after walkover at same Y (walkover under agent)', () => {
  const agents = [mockAgent('test', 100)];
  const walkover = [mockTile(0, 0, 100)];
  const queue = buildSortedRenderQueue(agents, walkover, [], []);
  assert.strictEqual(queue[0].layer, LAYER_WALKOVER, 'Walkover first');
  assert.strictEqual(queue[1].layer, LAYER_AGENT, 'Agent second');
});

test('Agent draws after furniture-mid at same Y (mid under agent)', () => {
  const agents = [mockAgent('test', 100)];
  const mid = [mockTile(0, 0, 100)];
  const queue = buildSortedRenderQueue(agents, [], mid, []);
  assert.strictEqual(queue[0].layer, LAYER_MID, 'Mid first');
  assert.strictEqual(queue[1].layer, LAYER_AGENT, 'Agent second');
});

test('Items at lower Y (higher on screen) draw first', () => {
  const agents = [mockAgent('front', 100), mockAgent('back', 200)];
  const queue = buildSortedRenderQueue(agents, [], [], []);
  assert.strictEqual(queue[0].sortY, 100, 'Lower Y first');
  assert.strictEqual(queue[1].sortY, 200, 'Higher Y second');
});

test('Depth sorting: agent behind furniture-mid when feet above tile', () => {
  const agents = [mockAgent('test', 90)];
  const mid = [mockTile(0, 0, 100)];
  const queue = buildSortedRenderQueue(agents, [], mid, []);
  assert.strictEqual(queue[0].sortY, 90, 'Agent with lower Y first (behind)');
  assert.strictEqual(queue[1].layer, LAYER_MID, 'Mid second (in front)');
});

test('Depth sorting: agent in front of furniture-mid when feet below tile', () => {
  const agents = [mockAgent('test', 110)];
  const mid = [mockTile(0, 0, 100)];
  const queue = buildSortedRenderQueue(agents, [], mid, []);
  assert.strictEqual(queue[0].layer, LAYER_MID, 'Mid with lower Y first (behind)');
  assert.strictEqual(queue[1].sortY, 110, 'Agent second (in front)');
});

test('Multiple agents sort by feet Y regardless of agent ID', () => {
  const agents = [
    mockAgent('grokbot', 150),
    mockAgent('jarvis', 120),
    mockAgent('claude', 180),
    mockAgent('friday', 120),
  ];
  const queue = buildSortedRenderQueue(agents, [], [], []);
  assert.strictEqual(queue[0].sortY, 120);
  assert.strictEqual(queue[1].sortY, 120);
  assert.strictEqual(queue[2].sortY, 150);
  assert.strictEqual(queue[3].sortY, 180);
});

console.log('\n--- Engine Render Pass Order Tests ---\n');

test('Wall-front always on top: not in depth-sorted queue with avatars', () => {
  // Per engine.ts, wall-front is drawn in PASS 4, after the depth-sorted queue
  // The buildSortedRenderQueue CAN include wall-front tiles, but engine.ts
  // calls it with empty wallsFrontTiles array: buildSortedRenderQueue(agents, [], midTiles, [])
  
  // Verify engine.ts passes empty array for wallsFrontTiles
  const enginePath = path.resolve(__dirname, '../src/engine.ts');
  const engine = fs.readFileSync(enginePath, 'utf-8');
  
  // Should find: buildSortedRenderQueue(agents, [], midTiles, [])
  assert.ok(
    engine.includes('buildSortedRenderQueue(agents, [], midTiles, [])'),
    'Engine should call buildSortedRenderQueue with empty wallsFrontTiles array'
  );
});

test('Wall-front drawn in separate pass after depth-sorted queue', () => {
  const enginePath = path.resolve(__dirname, '../src/engine.ts');
  const engine = fs.readFileSync(enginePath, 'utf-8');
  
  // Should have PASS 4 comment for wall-front
  assert.ok(
    engine.includes('PASS 4: Wall-front'),
    'Engine should have PASS 4 for wall-front'
  );
  
  // Should iterate wallsFrontTiles after the queue
  assert.ok(
    engine.includes('for (const tile of wallsFrontTiles)'),
    'Engine should iterate wallsFrontTiles separately'
  );
});

test('Shadows drawn before depth-sorted queue (PASS 2)', () => {
  const enginePath = path.resolve(__dirname, '../src/engine.ts');
  const engine = fs.readFileSync(enginePath, 'utf-8');
  
  assert.ok(
    engine.includes('PASS 2: Draw ALL shadows'),
    'Engine should have PASS 2 for shadows'
  );
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
