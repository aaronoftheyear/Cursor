#!/usr/bin/env node
/**
 * Engine spawn path must respect engineSpawnBottomRow (height - 1).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

console.log('\n=== Engine Spawn Bottom Row Tests ===\n');

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
const engineSrc = fs.readFileSync(path.join(root, 'src/engine.ts'), 'utf-8');

function callEngine(fnName, ...args) {
  const argsJson = args.map((a) => JSON.stringify(a)).join(', ');
  const code = `
    const m = require('./src/engine.ts');
    console.log(JSON.stringify(m.${fnName}(${argsJson})));
  `;
  const result = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    cwd: root,
    encoding: 'utf-8',
  });
  return JSON.parse(result.trim());
}

const walkableBottomMap = {
  width: 5,
  height: 4,
  blocked: [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1],
};
const room = { x: 0, y: 0, width: 5, height: 4 };
const bottomRow = 3;
const allWalkable = [
  { x: 1, y: 1 },
  { x: 2, y: 1 },
  { x: 3, y: 1 },
  { x: 1, y: 2 },
  { x: 2, y: 2 },
  { x: 3, y: 2 },
  { x: 1, y: 3 },
  { x: 2, y: 3 },
  { x: 3, y: 3 },
];

test('engineSpawnBottomRow returns height - 1', () => {
  assert.strictEqual(callEngine('engineSpawnBottomRow', 23), 22);
});

test('engineResolveSpawnFootTile never spawns on bottom row', () => {
  for (let i = 0; i < 60; i++) {
    const tile = callEngine('engineResolveSpawnFootTile', walkableBottomMap, room, allWalkable);
    assert.ok(tile);
    assert.notStrictEqual(tile.y, bottomRow);
  }
});

test('resolveSpawnFootTile uses engineSpawnBottomRow (not hardcoded -1)', () => {
  assert.ok(engineSrc.includes('engineSpawnBottomRow(collisionMap.height)'));
  assert.ok(engineSrc.includes('engineResolveSpawnFootTile'));
});

test('mutation bottomRow=-1 allows bottom-row spawn (guard must use height-1)', () => {
  const code = `
    const { pickEngineSpawnFootTile } = require('./src/spawnGuard.ts');
    const map = ${JSON.stringify(walkableBottomMap)};
    const room = ${JSON.stringify(room)};
    const walkables = ${JSON.stringify(allWalkable)};
    let hitBottom = false;
    for (let i = 0; i < 40; i++) {
      const tile = pickEngineSpawnFootTile(map, room, walkables, -1);
      if (tile && tile.y === ${bottomRow}) hitBottom = true;
    }
    console.log(JSON.stringify({ hitBottom }));
  `;
  const result = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    cwd: root,
    encoding: 'utf-8',
  });
  const { hitBottom } = JSON.parse(result.trim());
  assert.ok(hitBottom, 'bottomRow=-1 mutation must be detectable (spawns on bottom row)');
});

function runEngineResolveSpawnProbe() {
  const code = `
    const { engineResolveSpawnFootTile } = require('./src/engine.ts');
    const map = ${JSON.stringify(walkableBottomMap)};
    const room = ${JSON.stringify(room)};
    const walkables = ${JSON.stringify(allWalkable)};
    let hitBottom = false;
    for (let i = 0; i < 80; i++) {
      const tile = engineResolveSpawnFootTile(map, room, walkables);
      if (tile && tile.y === ${bottomRow}) hitBottom = true;
    }
    if (hitBottom) process.exit(2);
    console.log('ok');
  `;
  execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    cwd: root,
    encoding: 'utf-8',
  });
}

test('engine.ts mutation bottomRow=-1 fails engineResolveSpawnFootTile probe', () => {
  const enginePath = path.join(root, 'src/engine.ts');
  const original = fs.readFileSync(enginePath, 'utf-8');
  const mutated = original.replace('return mapHeight - 1;', 'return -1;');
  assert.notStrictEqual(mutated, original);
  fs.writeFileSync(enginePath, mutated);
  try {
    let threw = false;
    try {
      runEngineResolveSpawnProbe();
    } catch {
      threw = true;
    }
    assert.ok(threw, 'probe must fail when engineSpawnBottomRow returns -1');
  } finally {
    fs.writeFileSync(enginePath, original);
  }
});

test('engine.ts mutation forced {0,height-1} spawn fails engineResolveSpawnFootTile probe', () => {
  const enginePath = path.join(root, 'src/engine.ts');
  const original = fs.readFileSync(enginePath, 'utf-8');
  const needle =
    'const tile = pickEngineSpawnFootTile(collisionMap, room, walkableFallback, bottomRow);';
  const mutated = original.replace(
    needle,
    'const tile = { x: 0, y: collisionMap.height - 1 };'
  );
  assert.ok(mutated.includes('y: collisionMap.height - 1'), 'mutation apply failed');
  fs.writeFileSync(enginePath, mutated);
  try {
    let threw = false;
    try {
      runEngineResolveSpawnProbe();
    } catch {
      threw = true;
    }
    assert.ok(threw, 'probe must fail when engine always spawns at {0,height-1}');
  } finally {
    fs.writeFileSync(enginePath, original);
  }
});

test('mutation forced spawn {0,height-1} is invalid spawn', () => {
  const code = `
    const { isValidSpawnPosition } = require('./src/spawnGuard.ts');
    const map = ${JSON.stringify(walkableBottomMap)};
    const br = map.height - 1;
    const forced = { x: 0, y: br };
    console.log(JSON.stringify(isValidSpawnPosition(map, forced, br)));
  `;
  const result = execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    cwd: root,
    encoding: 'utf-8',
  });
  const validation = JSON.parse(result.trim());
  assert.strictEqual(validation.valid, false);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
