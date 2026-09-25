/**
 * Layer ordering tests for the render queue.
 * Verifies that all agents follow the same depth sorting rules:
 * 
 * Tiled layer → render order:
 *   grass/floor    → background (baked into mapBackground)
 *   furniture-low  → DRAW_WALKOVER (0)  - walkable, under avatar
 *   walls          → collision only (baked into mapBackground)
 *   furniture-mid  → DRAW_MID (-10)     - collision, depth sorted with avatar
 *   furniture-high → overlay (drawn after queue, always on top of avatar)
 *   wall-front     → DRAW_WALLS_FRONT (20) - collision, always on top of avatar+shadow
 * 
 * Shadow rule: always drawn under furniture-mid and avatar at same Y (order -20).
 */

const assert = require('assert');

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

// Layer order constants (must match engine.ts)
const DRAW_SHADOW = -20;
const DRAW_MID = -10;
const DRAW_WALKOVER = 0;
const DRAW_AGENT = 10;
const DRAW_WALLS_FRONT = 20;

// Simulated sort function (matches engine.ts)
function sortQueue(queue) {
  return queue.sort((a, b) => (a.sortY !== b.sortY ? a.sortY - b.sortY : a.order - b.order));
}

test('Shadow draws before mid at same Y', () => {
  const queue = [
    { sortY: 100, order: DRAW_MID, name: 'mid' },
    { sortY: 100, order: DRAW_SHADOW, name: 'shadow' },
  ];
  const sorted = sortQueue(queue);
  assert.strictEqual(sorted[0].name, 'shadow', 'Shadow should be first');
  assert.strictEqual(sorted[1].name, 'mid', 'Mid should be second');
});

test('Shadow draws before agent at same Y', () => {
  const queue = [
    { sortY: 100, order: DRAW_AGENT, name: 'agent' },
    { sortY: 100, order: DRAW_SHADOW, name: 'shadow' },
  ];
  const sorted = sortQueue(queue);
  assert.strictEqual(sorted[0].name, 'shadow', 'Shadow should be first');
  assert.strictEqual(sorted[1].name, 'agent', 'Agent should be second');
});

test('Walkover (furniture-low) draws before agent at same Y', () => {
  const queue = [
    { sortY: 100, order: DRAW_AGENT, name: 'agent' },
    { sortY: 100, order: DRAW_WALKOVER, name: 'walkover' },
  ];
  const sorted = sortQueue(queue);
  assert.strictEqual(sorted[0].name, 'walkover', 'Walkover should be first (under agent)');
  assert.strictEqual(sorted[1].name, 'agent', 'Agent should be second (on top)');
});

test('Walls-front draws after agent at same Y', () => {
  const queue = [
    { sortY: 100, order: DRAW_WALLS_FRONT, name: 'walls-front' },
    { sortY: 100, order: DRAW_AGENT, name: 'agent' },
  ];
  const sorted = sortQueue(queue);
  assert.strictEqual(sorted[0].name, 'agent', 'Agent should be first (under walls-front)');
  assert.strictEqual(sorted[1].name, 'walls-front', 'Walls-front should be second (on top)');
});

test('Walls-front draws after shadow at same Y', () => {
  const queue = [
    { sortY: 100, order: DRAW_WALLS_FRONT, name: 'walls-front' },
    { sortY: 100, order: DRAW_SHADOW, name: 'shadow' },
  ];
  const sorted = sortQueue(queue);
  assert.strictEqual(sorted[0].name, 'shadow', 'Shadow should be first (under walls-front)');
  assert.strictEqual(sorted[1].name, 'walls-front', 'Walls-front should be second (on top)');
});

test('Full layer order at same Y: shadow < mid < walkover < agent < walls-front', () => {
  const queue = [
    { sortY: 100, order: DRAW_WALLS_FRONT, name: 'walls-front' },
    { sortY: 100, order: DRAW_AGENT, name: 'agent' },
    { sortY: 100, order: DRAW_WALKOVER, name: 'walkover' },
    { sortY: 100, order: DRAW_MID, name: 'mid' },
    { sortY: 100, order: DRAW_SHADOW, name: 'shadow' },
  ];
  const sorted = sortQueue(queue);
  assert.strictEqual(sorted[0].name, 'shadow');
  assert.strictEqual(sorted[1].name, 'mid');
  assert.strictEqual(sorted[2].name, 'walkover');
  assert.strictEqual(sorted[3].name, 'agent');
  assert.strictEqual(sorted[4].name, 'walls-front');
});

test('Items at lower Y (higher on screen) draw first', () => {
  const queue = [
    { sortY: 200, order: DRAW_AGENT, name: 'agent-back' },
    { sortY: 100, order: DRAW_AGENT, name: 'agent-front' },
  ];
  const sorted = sortQueue(queue);
  assert.strictEqual(sorted[0].name, 'agent-front', 'Lower Y agent should draw first (behind)');
  assert.strictEqual(sorted[1].name, 'agent-back', 'Higher Y agent should draw second (in front)');
});

test('Depth sorting: agent behind furniture-mid when feet above tile', () => {
  // Agent feet at Y=90, furniture-mid tile bottom at Y=100
  const queue = [
    { sortY: 100, order: DRAW_MID, name: 'mid' },
    { sortY: 90, order: DRAW_AGENT, name: 'agent' },
  ];
  const sorted = sortQueue(queue);
  assert.strictEqual(sorted[0].name, 'agent', 'Agent with lower Y draws first (behind)');
  assert.strictEqual(sorted[1].name, 'mid', 'Mid draws second (in front of agent)');
});

test('Depth sorting: agent in front of furniture-mid when feet below tile', () => {
  // Agent feet at Y=110, furniture-mid tile bottom at Y=100
  const queue = [
    { sortY: 100, order: DRAW_MID, name: 'mid' },
    { sortY: 110, order: DRAW_AGENT, name: 'agent' },
  ];
  const sorted = sortQueue(queue);
  assert.strictEqual(sorted[0].name, 'mid', 'Mid with lower Y draws first (behind)');
  assert.strictEqual(sorted[1].name, 'agent', 'Agent draws second (in front of mid)');
});

test('Multiple agents sort by feet Y regardless of agent ID', () => {
  // Simulates different agents with different Y positions
  const queue = [
    { sortY: 150, order: DRAW_AGENT, name: 'agent-grokbot' },
    { sortY: 120, order: DRAW_AGENT, name: 'agent-jarvis' },
    { sortY: 180, order: DRAW_AGENT, name: 'agent-claude' },
    { sortY: 120, order: DRAW_AGENT, name: 'agent-friday' }, // Same Y as jarvis
  ];
  const sorted = sortQueue(queue);
  assert.strictEqual(sorted[0].sortY, 120, 'Lowest Y agents first');
  assert.strictEqual(sorted[1].sortY, 120, 'Same Y agents together');
  assert.strictEqual(sorted[2].sortY, 150, 'Middle Y agent');
  assert.strictEqual(sorted[3].sortY, 180, 'Highest Y agent last');
});

test('Shadows follow their agents in depth order', () => {
  // Two agents at different Y positions with their shadows
  const queue = [
    { sortY: 150, order: DRAW_AGENT, name: 'agent-back' },
    { sortY: 150, order: DRAW_SHADOW, name: 'shadow-back' },
    { sortY: 100, order: DRAW_AGENT, name: 'agent-front' },
    { sortY: 100, order: DRAW_SHADOW, name: 'shadow-front' },
  ];
  const sorted = sortQueue(queue);
  // At Y=100: shadow first, then agent
  assert.strictEqual(sorted[0].name, 'shadow-front');
  assert.strictEqual(sorted[1].name, 'agent-front');
  // At Y=150: shadow first, then agent
  assert.strictEqual(sorted[2].name, 'shadow-back');
  assert.strictEqual(sorted[3].name, 'agent-back');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
