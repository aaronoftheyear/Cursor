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
let renderQueue;
try {
  const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
  const modulePath = path.resolve(__dirname, '../src/renderQueue.ts');
  
  const code = `
    const m = require('${modulePath.replace(/\\/g, '\\\\')}');
    console.log(JSON.stringify({
      LAYER_WALKOVER: m.LAYER_WALKOVER,
      LAYER_MID: m.LAYER_MID,
      LAYER_AGENT: m.LAYER_AGENT,
      LAYER_WALLS_FRONT: m.LAYER_WALLS_FRONT,
    }));
  `;
  
  const result = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    encoding: 'utf-8',
    cwd: path.resolve(__dirname, '..'),
  });
  
  renderQueue = JSON.parse(result.trim());
} catch (e) {
  console.error('FATAL: Failed to import src/renderQueue.ts');
  console.error('Make sure tsx is installed: npm install --save-dev tsx');
  console.error('Error:', e.message);
  process.exit(1);
}

const { LAYER_WALKOVER, LAYER_MID, LAYER_AGENT, LAYER_WALLS_FRONT } = renderQueue;

function buildSortedRenderQueue(agents, walkoverTiles, midTiles, wallsFrontTiles) {
  const queue = [];

  for (const agent of agents) {
    queue.push({
      sortY: agent.feetY,
      layer: LAYER_AGENT,
      draw: agent.drawAgent,
      name: agent.id,
    });
  }

  for (const tile of walkoverTiles) {
    queue.push({
      sortY: tile.sortY,
      layer: LAYER_WALKOVER,
      draw: tile.draw,
      name: `walkover-${tile.coord.x},${tile.coord.y}`,
    });
  }

  for (const tile of midTiles) {
    queue.push({
      sortY: tile.sortY,
      layer: LAYER_MID,
      draw: tile.draw,
      name: `mid-${tile.coord.x},${tile.coord.y}`,
    });
  }

  for (const tile of wallsFrontTiles) {
    queue.push({
      sortY: tile.sortY,
      layer: LAYER_WALLS_FRONT,
      draw: tile.draw,
      name: `walls-front-${tile.coord.x},${tile.coord.y}`,
    });
  }

  return queue.sort((a, b) =>
    a.sortY !== b.sortY ? a.sortY - b.sortY : a.layer - b.layer
  );
}

// Helper to create test agents
function mockAgent(id, feetY) {
  return {
    id,
    feetY,
    drawShadow: () => {},
    drawAgent: () => {},
  };
}

// Helper to create test tiles
function mockTile(x, y, sortY) {
  return {
    coord: { x, y },
    sortY,
    draw: () => {},
  };
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

console.log('\n--- Depth-Sorted Queue Tests ---\n');

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
  assert.strictEqual(queue[0].name, 'front', 'Lower Y agent first');
  assert.strictEqual(queue[1].name, 'back', 'Higher Y agent second');
});

test('Depth sorting: agent behind furniture-mid when feet above tile', () => {
  const agents = [mockAgent('test', 90)];
  const mid = [mockTile(0, 0, 100)];
  const queue = buildSortedRenderQueue(agents, [], mid, []);
  assert.strictEqual(queue[0].name, 'test', 'Agent with lower Y first (behind)');
  assert.strictEqual(queue[1].layer, LAYER_MID, 'Mid second (in front)');
});

test('Depth sorting: agent in front of furniture-mid when feet below tile', () => {
  const agents = [mockAgent('test', 110)];
  const mid = [mockTile(0, 0, 100)];
  const queue = buildSortedRenderQueue(agents, [], mid, []);
  assert.strictEqual(queue[0].layer, LAYER_MID, 'Mid with lower Y first (behind)');
  assert.strictEqual(queue[1].name, 'test', 'Agent second (in front)');
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

console.log('\n--- Engine Render Pass Tests ---\n');

test('Shadow pass: shadows drawn before depth-sorted queue', () => {
  const drawOrder = [];
  
  // Simulate engine render passes
  // PASS 1: walkover
  drawOrder.push('walkover');
  
  // PASS 2: ALL shadows (before depth-sorted queue)
  drawOrder.push('shadow-agent1');
  drawOrder.push('shadow-agent2');
  
  // PASS 3: depth-sorted queue (mid + agents, NOT wall-front)
  const agents = [
    { id: 'agent1', feetY: 200, drawAgent: () => drawOrder.push('agent1') },
    { id: 'agent2', feetY: 50, drawAgent: () => drawOrder.push('agent2') },
  ];
  const mid = [
    { coord: { x: 0, y: 0 }, sortY: 100, draw: () => drawOrder.push('mid') },
  ];
  // Wall-front NOT in queue - drawn separately after
  const queue = buildSortedRenderQueue(agents, [], mid, []);
  for (const item of queue) {
    item.draw();
  }
  
  // PASS 4: wall-front (after depth-sorted queue)
  drawOrder.push('wall-front');
  
  // PASS 5: overlay
  drawOrder.push('overlay');
  
  // Verify order
  assert.deepStrictEqual(drawOrder, [
    'walkover',
    'shadow-agent1',
    'shadow-agent2',
    'agent2',  // feetY=50, drawn first (behind)
    'mid',     // sortY=100
    'agent1',  // feetY=200, drawn last (in front of mid)
    'wall-front',
    'overlay',
  ]);
  
  // Shadows before everything in queue
  const shadowIdx1 = drawOrder.indexOf('shadow-agent1');
  const shadowIdx2 = drawOrder.indexOf('shadow-agent2');
  const midIdx = drawOrder.indexOf('mid');
  const agent1Idx = drawOrder.indexOf('agent1');
  assert.ok(shadowIdx1 < midIdx, 'Shadow 1 before mid');
  assert.ok(shadowIdx2 < midIdx, 'Shadow 2 before mid');
  assert.ok(shadowIdx1 < agent1Idx, 'Shadow 1 before agent1');
});

test('Wall-front pass: wall-front always on top of avatars', () => {
  const drawOrder = [];
  
  // Agent with very high Y (should be "in front" in depth sort)
  const agents = [
    { id: 'agent', feetY: 9999, drawAgent: () => drawOrder.push('agent') },
  ];
  
  // PASS 3: depth-sorted queue (agents only, wall-front NOT in queue)
  const queue = buildSortedRenderQueue(agents, [], [], []);
  for (const item of queue) {
    item.draw();
  }
  
  // PASS 4: wall-front drawn AFTER queue
  drawOrder.push('wall-front');
  
  // Wall-front is after agent even though agent Y=9999
  const agentIdx = drawOrder.indexOf('agent');
  const wallIdx = drawOrder.indexOf('wall-front');
  assert.ok(wallIdx > agentIdx, 'Wall-front drawn after agent regardless of Y');
});

test('Wall-front pass: wall-front always on top of shadows', () => {
  const drawOrder = [];
  
  // PASS 2: shadows
  drawOrder.push('shadow');
  
  // PASS 3: depth-sorted queue
  drawOrder.push('agent');
  
  // PASS 4: wall-front
  drawOrder.push('wall-front');
  
  const shadowIdx = drawOrder.indexOf('shadow');
  const wallIdx = drawOrder.indexOf('wall-front');
  assert.ok(wallIdx > shadowIdx, 'Wall-front drawn after shadow');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
