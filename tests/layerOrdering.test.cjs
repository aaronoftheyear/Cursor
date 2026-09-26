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

console.log('\n--- Engine Render Pass Delegation Tests ---\n');

test('Engine delegates rendering to executeRenderPasses', () => {
  const enginePath = path.resolve(__dirname, '../src/engine.ts');
  const engine = fs.readFileSync(enginePath, 'utf-8');
  
  assert.ok(
    engine.includes('executeRenderPasses('),
    'Engine should call executeRenderPasses'
  );
});

test('Engine passes wallsFrontTiles to executeRenderPasses', () => {
  const enginePath = path.resolve(__dirname, '../src/engine.ts');
  const engine = fs.readFileSync(enginePath, 'utf-8');
  
  // The executeRenderPasses call should include wallsFrontTiles
  assert.ok(
    engine.includes('wallsFrontTiles,'),
    'Engine should pass wallsFrontTiles to executeRenderPasses'
  );
});

test('renderQueue.ts has correct pass order documentation', () => {
  const renderQueuePath = path.resolve(__dirname, '../src/renderQueue.ts');
  const renderQueue = fs.readFileSync(renderQueuePath, 'utf-8');
  
  assert.ok(
    renderQueue.includes('PASS 1: Walkover'),
    'renderQueue should document PASS 1 for walkover'
  );
  assert.ok(
    renderQueue.includes('PASS 2:') && renderQueue.includes('shadow'),
    'renderQueue should document PASS 2 for shadows'
  );
  assert.ok(
    renderQueue.includes('PASS 3:') && renderQueue.includes('Depth-sorted'),
    'renderQueue should document PASS 3 for depth-sorted queue'
  );
  assert.ok(
    renderQueue.includes('PASS 4:') && renderQueue.includes('Wall-front'),
    'renderQueue should document PASS 4 for wall-front'
  );
  assert.ok(
    renderQueue.includes('PASS 5:') && renderQueue.includes('Overlay'),
    'renderQueue should document PASS 5 for overlay'
  );
});

console.log('\n--- executeRenderPasses Draw Call Recording Tests ---\n');

// Test executeRenderPasses by recording draw calls
function testExecuteRenderPasses() {
  const testCode = `
    const m = require('${path.resolve(__dirname, '../src/renderQueue.ts').replace(/\\/g, '\\\\')}');
    
    const drawCalls = [];
    
    const agents = [
      { id: 'agent1', feetY: 100, drawShadow: () => drawCalls.push('shadow:agent1'), drawAgent: () => drawCalls.push('agent:agent1') },
      { id: 'agent2', feetY: 150, drawShadow: () => drawCalls.push('shadow:agent2'), drawAgent: () => drawCalls.push('agent:agent2') },
    ];
    const walkoverTiles = [
      { coord: { x: 5, y: 5 }, sortY: 80, draw: () => drawCalls.push('walkover:5,5') },
    ];
    const midTiles = [
      { coord: { x: 10, y: 10 }, sortY: 120, draw: () => drawCalls.push('mid:10,10') },
    ];
    const wallsFrontTiles = [
      { coord: { x: 8, y: 8 }, sortY: 90, draw: () => drawCalls.push('walls-front:8,8') },
    ];
    
    m.executeRenderPasses(agents, walkoverTiles, midTiles, wallsFrontTiles, () => drawCalls.push('overlay'));
    
    console.log(JSON.stringify(drawCalls));
  `;
  
  const result = execSync(`"${path.resolve(__dirname, '../node_modules/.bin/tsx')}" -e "${testCode.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    encoding: 'utf-8',
    cwd: path.resolve(__dirname, '..'),
  });
  
  return JSON.parse(result.trim());
}

test('executeRenderPasses: walkover draws before shadows (pass 1 before pass 2)', () => {
  const calls = testExecuteRenderPasses();
  const walkoverIdx = calls.findIndex(c => c.startsWith('walkover:'));
  const shadowIdx = calls.findIndex(c => c.startsWith('shadow:'));
  assert.ok(walkoverIdx < shadowIdx, `Walkover (${walkoverIdx}) should draw before shadow (${shadowIdx})`);
});

test('executeRenderPasses: all shadows draw before any agent (pass 2 before pass 3)', () => {
  const calls = testExecuteRenderPasses();
  const lastShadowIdx = Math.max(...calls.map((c, i) => c.startsWith('shadow:') ? i : -1));
  const firstAgentIdx = calls.findIndex(c => c.startsWith('agent:'));
  assert.ok(lastShadowIdx < firstAgentIdx, `Last shadow (${lastShadowIdx}) should draw before first agent (${firstAgentIdx})`);
});

test('executeRenderPasses: furniture-mid depth-sorts with agents in pass 3', () => {
  const calls = testExecuteRenderPasses();
  // mid:10,10 has sortY=120, between agent1 (100) and agent2 (150)
  const agent1Idx = calls.indexOf('agent:agent1');
  const midIdx = calls.indexOf('mid:10,10');
  const agent2Idx = calls.indexOf('agent:agent2');
  assert.ok(agent1Idx < midIdx, `Agent1 at Y=100 (${agent1Idx}) should draw before mid at Y=120 (${midIdx})`);
  assert.ok(midIdx < agent2Idx, `Mid at Y=120 (${midIdx}) should draw before agent2 at Y=150 (${agent2Idx})`);
});

test('executeRenderPasses: wall-front draws AFTER all agents (pass 4 after pass 3)', () => {
  const calls = testExecuteRenderPasses();
  const lastAgentIdx = Math.max(...calls.map((c, i) => c.startsWith('agent:') ? i : -1));
  const wallsFrontIdx = calls.findIndex(c => c.startsWith('walls-front:'));
  assert.ok(lastAgentIdx < wallsFrontIdx, `Last agent (${lastAgentIdx}) should draw before walls-front (${wallsFrontIdx})`);
});

test('executeRenderPasses: wall-front draws AFTER furniture-mid (pass 4 after pass 3)', () => {
  const calls = testExecuteRenderPasses();
  const midIdx = calls.indexOf('mid:10,10');
  const wallsFrontIdx = calls.findIndex(c => c.startsWith('walls-front:'));
  assert.ok(midIdx < wallsFrontIdx, `Mid (${midIdx}) should draw before walls-front (${wallsFrontIdx})`);
});

test('executeRenderPasses: overlay draws last (pass 5)', () => {
  const calls = testExecuteRenderPasses();
  const overlayIdx = calls.indexOf('overlay');
  assert.strictEqual(overlayIdx, calls.length - 1, 'Overlay should be the last draw call');
});

test('executeRenderPasses: wall-front at low Y still draws after agent at high Y', () => {
  // Wall-front at Y=90 should still draw AFTER agent at Y=150
  // This is the critical test - wall-front is always on top regardless of Y
  const calls = testExecuteRenderPasses();
  const agent2Idx = calls.indexOf('agent:agent2');  // Y=150
  const wallsFrontIdx = calls.indexOf('walls-front:8,8');  // Y=90, but still drawn after
  assert.ok(agent2Idx < wallsFrontIdx, 
    `Agent2 at Y=150 (${agent2Idx}) should draw before walls-front at Y=90 (${wallsFrontIdx}) - wall-front always on top!`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
