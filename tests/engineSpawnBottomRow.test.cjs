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
const enginePath = path.join(root, 'src/engine.ts');

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

function runGameSpawnProbe() {
  const code = `
    const { engineGameSpawnFootTile } = require('./src/engine.ts');
    const map = ${JSON.stringify(walkableBottomMap)};
    const walkables = ${JSON.stringify(allWalkable)};
    let hitBottom = false;
    for (let i = 0; i < 80; i++) {
      const tile = engineGameSpawnFootTile(map, null, walkables, () => true);
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

test('engineGameSpawnFootTile avoids bottom row (same path as GameEngine)', () => {
  const code = `
    const { engineGameSpawnFootTile } = require('./src/engine.ts');
    const map = ${JSON.stringify(walkableBottomMap)};
    const walkables = ${JSON.stringify(allWalkable)};
    let hitBottom = false;
    for (let i = 0; i < 80; i++) {
      const tile = engineGameSpawnFootTile(map, null, walkables, (t) => t.y !== ${bottomRow});
      if (tile && tile.y === ${bottomRow}) hitBottom = true;
    }
    if (hitBottom) process.exit(2);
    console.log('ok');
  `;
  execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
    cwd: root,
    encoding: 'utf-8',
  });
});

test('engine.ts mutation bottomRow=-1 fails engineResolveSpawnFootTile probe', () => {
  const original = fs.readFileSync(enginePath, 'utf-8');
  const mutated = original.replace('return mapHeight - 1;', 'return -1;');
  fs.writeFileSync(enginePath, mutated);
  try {
    let threw = false;
    try {
      runGameSpawnProbe();
    } catch {
      threw = true;
    }
    assert.ok(threw, 'probe must fail when engineSpawnBottomRow returns -1');
  } finally {
    fs.writeFileSync(enginePath, original);
  }
});

test('engine.ts mutation bypassing resolver fails engineGameSpawnFootTile probe', () => {
  const original = fs.readFileSync(enginePath, 'utf-8');
  const mutated = original.replace(
    'const tile = engineResolveSpawnFootTile(collisionMap, room, walkableFallback);',
    'const tile = { x: 0, y: collisionMap.height - 1 };'
  );
  assert.notStrictEqual(mutated, original);
  fs.writeFileSync(enginePath, mutated);
  try {
    let threw = false;
    try {
      runGameSpawnProbe();
    } catch {
      threw = true;
    }
    assert.ok(threw, 'probe must fail when spawn bypasses resolver and forces bottom row');
  } finally {
    fs.writeFileSync(enginePath, original);
  }
});

test('occupied tile rejection tries another walkable tile', () => {
  const code = `
    const { engineGameSpawnFootTile } = require('./src/engine.ts');
    const map = ${JSON.stringify(walkableBottomMap)};
    const walkables = [{ x: 2, y: 1 }, { x: 3, y: 1 }];
    const blocked = new Set(['2,1']);
    const canOccupy = (t) => !blocked.has(t.x + ',' + t.y);
    let ok = false;
    for (let i = 0; i < 30; i++) {
      const tile = engineGameSpawnFootTile(map, null, walkables, canOccupy);
      if (tile && canOccupy(tile)) ok = true;
    }
    console.log(JSON.stringify(ok));
  `;
  const ok = JSON.parse(
    execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      cwd: root,
      encoding: 'utf-8',
    }).trim()
  );
  assert.ok(ok, 'fallback must eventually return a non-blocked walkable tile');
});

test('mutation forced spawn {0,height-1} is invalid spawn', () => {
  const code = `
    const { isValidSpawnPosition } = require('./src/spawnGuard.ts');
    const map = ${JSON.stringify(walkableBottomMap)};
    const br = map.height - 1;
    console.log(JSON.stringify(isValidSpawnPosition(map, { x: 0, y: br }, br)));
  `;
  const validation = JSON.parse(
    execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      cwd: root,
      encoding: 'utf-8',
    }).trim()
  );
  assert.strictEqual(validation.valid, false);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
