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

test('engineSpawnOccupiedFallback returns first free walkable in list', () => {
  const code = `
    const { engineSpawnOccupiedFallback } = require('./src/engine.ts');
    const tile = engineSpawnOccupiedFallback(${walkableBottomMap.height}, [{ x: 2, y: 1 }, { x: 3, y: 1 }], (t) => t.x === 3);
    console.log(JSON.stringify(tile));
  `;
  const tile = JSON.parse(
    execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      cwd: root,
      encoding: 'utf-8',
    }).trim()
  );
  assert.deepStrictEqual(tile, { x: 3, y: 1 });
});

test('engineSpawnOccupiedFallback picks alternate when resolver tile blocked', () => {
  const code = `
    const { engineGameSpawnFootTile } = require('./src/engine.ts');
    const map = ${JSON.stringify(walkableBottomMap)};
    const walkables = [{ x: 2, y: 1 }, { x: 3, y: 1 }];
    let sawFallback = false;
    for (let i = 0; i < 40; i++) {
      const tile = engineGameSpawnFootTile(map, null, walkables, (t) => t.x === 3);
      if (tile && tile.x === 3 && tile.y === 1) sawFallback = true;
    }
    console.log(JSON.stringify(sawFallback));
  `;
  const sawFallback = JSON.parse(
    execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      cwd: root,
      encoding: 'utf-8',
    }).trim()
  );
  assert.ok(sawFallback, 'occupied resolver tile must fall back to another walkable');
});

test('enginePreferredSpawnFootTile rejects bottom-row preferred tile', () => {
  const tile = callEngine('enginePreferredSpawnFootTile', { x: 2, y: bottomRow }, walkableBottomMap.height, true);
  assert.strictEqual(tile, null);
  const ok = callEngine('enginePreferredSpawnFootTile', { x: 2, y: 1 }, walkableBottomMap.height, true);
  assert.deepStrictEqual(ok, { x: 2, y: 1 });
});

test('engine.ts mutation deleting occupied fallback fails probe', () => {
  const original = fs.readFileSync(enginePath, 'utf-8');
  const mutated = original.replace(
    `  for (const fallback of shuffled) {
    if (canOccupyTile(fallback)) return fallback;
  }`,
    '  /* fallback removed */'
  );
  assert.notStrictEqual(mutated, original);
  fs.writeFileSync(enginePath, mutated);
  try {
    let caught = false;
    try {
      const code = `
        const { engineSpawnOccupiedFallback } = require('./src/engine.ts');
        const tile = engineSpawnOccupiedFallback(${walkableBottomMap.height}, [{ x: 2, y: 1 }, { x: 3, y: 1 }], (t) => t.x === 3);
        console.log(JSON.stringify(tile));
      `;
      const tile = JSON.parse(
        execSync(`"${tsxPath}" -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
          cwd: root,
          encoding: 'utf-8',
        }).trim()
      );
      assert.deepStrictEqual(tile, { x: 3, y: 1 });
    } catch {
      caught = true;
    }
    assert.ok(caught, 'without occupied fallback loop, blocked tiles cannot spawn');
  } finally {
    fs.writeFileSync(enginePath, original);
  }
});

test('engine.ts mutation preferred bottom row fails probe', () => {
  const original = fs.readFileSync(enginePath, 'utf-8');
  const mutated = original.replace(
    'if (canOccupyPreferred && preferred.y !== bottomRow) {',
    'if (canOccupyPreferred) {'
  );
  assert.notStrictEqual(mutated, original);
  fs.writeFileSync(enginePath, mutated);
  try {
    let caught = false;
    try {
      const tile = callEngine(
        'enginePreferredSpawnFootTile',
        { x: 1, y: bottomRow },
        walkableBottomMap.height,
        true
      );
      assert.strictEqual(tile, null, 'preferred spawn on bottom row must remain blocked');
    } catch {
      caught = true;
    }
    assert.ok(caught, 'mutation allowing bottom-row preferred tile must fail probe');
  } finally {
    fs.writeFileSync(enginePath, original);
  }
});

test('engine.ts mutation force {0,height-1} in engineGameSpawnFootTile fails probe', () => {
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
    assert.ok(threw, 'forcing bottom row in engineGameSpawnFootTile must fail probe');
  } finally {
    fs.writeFileSync(enginePath, original);
  }
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
