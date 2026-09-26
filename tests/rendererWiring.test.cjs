#!/usr/bin/env node
/**
 * Ensures Renderer wiring passes displayScale and clickBoxTiles into agentDisplayMath.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

console.log('\n=== Renderer Wiring Tests ===\n');

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

const root = path.resolve(__dirname, '..');
const tsxPath = path.resolve(__dirname, '../node_modules/.bin/tsx');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'public/assets/manifest.json'), 'utf-8')
);
const rendererSrc = fs.readFileSync(path.join(root, 'src/renderer.ts'), 'utf-8');

function callResolve(fnName, ...args) {
  const argsJson = args.map((a) => JSON.stringify(a)).join(', ');
  const code = `
    const m = require('./src/renderer.ts');
    console.log(JSON.stringify(m.${fnName}(${argsJson})));
  `;
  const result = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    cwd: root,
    encoding: 'utf-8',
  });
  return JSON.parse(result.trim());
}

test('spritePixelSize delegates to resolveAgentSpritePixelSize', () => {
  assert.ok(rendererSrc.includes('resolveAgentSpritePixelSize(agentId, manifest'));
});

test('agentClickBox delegates to resolveAgentClickBox', () => {
  assert.ok(rendererSrc.includes('resolveAgentClickBox(agent, manifest'));
});

test('resolveAgentSpritePixelSize uses manifest displayScale', () => {
  const scaled = callResolve(
    'resolveAgentSpritePixelSize',
    'cursor-cloud',
    manifest,
    64,
    64,
    32
  );
  const unscaled = callResolve('resolveAgentSpritePixelSize', 'cursor-cloud', null, 64, 64, 32);
  const withScaleOne = callResolve(
    'resolveAgentSpritePixelSize',
    'cursor-cloud',
    { ...manifest, agents: { ...manifest.agents, 'cursor-cloud': { ...manifest.agents['cursor-cloud'], displayScale: 1 } } },
    64,
    64,
    32
  );
  assert.notStrictEqual(scaled.height, withScaleOne.height);
  assert.notStrictEqual(scaled.height, unscaled.height);
});

test('resolveAgentShadowRadii narrows cursor-cloud shadow vs full sprite width', () => {
  const spriteSize = callResolve('resolveAgentSpritePixelSize', 'cursor-cloud', manifest, 64, 64, 32);
  const withBox = callResolve('resolveAgentShadowRadii', 'cursor-cloud', spriteSize, 32, manifest, 1);
  const full = callResolve('resolveAgentShadowRadii', 'cursor-cloud', spriteSize, 32, null, 1);
  assert.ok(withBox.radiusX < full.radiusX);
});

test('bypassing agentShadowEllipseRadii in resolveAgentShadowRadii fails shadow regression', () => {
  const rendererPath = path.join(root, 'src/renderer.ts');
  const original = fs.readFileSync(rendererPath, 'utf-8');
  const spriteSize = callResolve('resolveAgentSpritePixelSize', 'cursor-cloud', manifest, 64, 64, 32);
  const before = callResolve('resolveAgentShadowRadii', 'cursor-cloud', spriteSize, 32, manifest, 1);
  const mutated = original.replace(
    'return agentShadowEllipseRadii(spriteSize, tile, clickBoxTiles, shadowScale);',
    'return { radiusX: spriteSize.width / 2, radiusY: spriteSize.width / 4 };'
  );
  fs.writeFileSync(rendererPath, mutated);
  try {
    const after = callResolve('resolveAgentShadowRadii', 'cursor-cloud', spriteSize, 32, manifest, 1);
    assert.ok(after.radiusX > before.radiusX, 'bypass must inflate shadow vs click-box foot width');
  } finally {
    fs.writeFileSync(rendererPath, original);
  }
});

function drawAgentShadowSource(src) {
  const start = src.indexOf('drawAgentShadow(agent: Agent)');
  const end = src.indexOf('drawAgent(agent:', start);
  return src.slice(start, end);
}

test('drawAgentShadow calls agentShadowEllipseRadii', () => {
  assert.ok(drawAgentShadowSource(rendererSrc).includes('agentShadowEllipseRadii('));
});

test('bypassing agentShadowEllipseRadii inside drawAgentShadow fails probe', () => {
  const rendererPath = path.join(root, 'src/renderer.ts');
  const original = fs.readFileSync(rendererPath, 'utf-8');
  const mutated = original.replace(
    'const { radiusX, radiusY } = agentShadowEllipseRadii(',
    'const { radiusX, radiusY } = { radiusX: size.width / 2, radiusY: size.width / 4 };'
  );
  assert.notStrictEqual(mutated, original);
  fs.writeFileSync(rendererPath, mutated);
  try {
    let caught = false;
    try {
      const block = drawAgentShadowSource(fs.readFileSync(rendererPath, 'utf-8'));
      assert.ok(block.includes('agentShadowEllipseRadii('), 'drawAgentShadow must keep agentShadowEllipseRadii');
    } catch {
      caught = true;
    }
    assert.ok(caught, 'bypassing agentShadowEllipseRadii in drawAgentShadow must fail probe');
  } finally {
    fs.writeFileSync(rendererPath, original);
  }
});

test('resolveAgentClickBox uses clickBoxTiles height', () => {
  const agent = { id: 'cursor-cloud', x: 40, y: 80, targetX: 40, targetY: 80 };
  const spriteSize = callResolve(
    'resolveAgentSpritePixelSize',
    'cursor-cloud',
    manifest,
    64,
    64,
    32
  );
  const box = callResolve('resolveAgentClickBox', agent, manifest, spriteSize, 32);
  const clickH = manifest.agents['cursor-cloud'].clickBoxTiles.height * 32;
  assert.strictEqual(box.height, clickH);
  assert.notStrictEqual(box.height, spriteSize.height);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
