#!/usr/bin/env node
/**
 * Apply one-line regressions and assert the matching guard test fails (not crashes).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf-8');
}

function write(rel, text) {
  fs.writeFileSync(path.join(PROJECT_ROOT, rel), text);
}

function runTest(rel) {
  try {
    execFileSync('node', [path.join(PROJECT_ROOT, rel)], {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
    });
    return { ok: true };
  } catch (err) {
    const out = `${err.stdout || ''}${err.stderr || ''}`;
    return { ok: false, out };
  }
}

function verify(name, files, mutate, testFile) {
  const backups = files.map((rel) => ({ rel, text: read(rel) }));
  try {
    for (const { rel } of backups) mutate(rel);
    const result = runTest(testFile);
    if (result.ok) {
      console.log(`✗ ${name}: expected test failure but passed`);
      return false;
    }
    if (!result.out.includes('✗') && !result.out.toLowerCase().includes('error')) {
      console.log(`✗ ${name}: failed but may have crashed:\n${result.out.slice(0, 400)}`);
      return false;
    }
    console.log(`✓ ${name}: guard failed as expected (${testFile})`);
    return true;
  } finally {
    for (const { rel, text } of backups) write(rel, text);
  }
}

let passed = 0;
let failed = 0;

function check(name, ok) {
  if (ok) passed++;
  else failed++;
}

check(
  'partial line dropped (offset=file size)',
  verify(
    'partial offset bug',
    ['server/agentActivity/providers/claudeSessionLogProvider.ts'],
    (rel) => {
      const src = read(rel);
      write(
        rel,
        src.replace(
          'const newOffset = incomplete ? endOfCompleteLines : stat.size',
          'const newOffset = stat.size'
        )
      );
    },
    'tests/agentActivityMutationGuards.test.cjs'
  )
);

check(
  'progress refresh removed (provider)',
  verify(
    'provider progress refresh',
    ['server/agentActivity/providers/claudeSessionLogProvider.ts'],
    (rel) => {
      const src = read(rel);
      write(rel, src.replace('if (result.refreshPermissionTimer) this.schedulePermissionTimer(sessionId)', ''));
    },
    'tests/agentActivityMutationGuards.test.cjs'
  )
);

check(
  'progress not recognised (parser)',
  verify(
    'parser progress',
    ['server/agentActivity/claudeJsonlParser.ts'],
    (rel) => {
      const src = read(rel);
      write(
        rel,
        src.replace(
          /if \(dataType === 'bash_progress' \|\| dataType === 'mcp_progress' \|\| hasToolLink\) \{[\s\S]*?refreshPermissionTimer = true[\s\S]*?\}/,
          'if (false) { refreshPermissionTimer = true }'
        )
      );
    },
    'tests/agentActivityMutationGuards.test.cjs'
  )
);

check(
  'per-agent queue removed',
  verify(
    'flat queue',
    ['server/agentActivity/applyViaPython.ts'],
    (rel) => {
      let src = read(rel);
      src = src.replace('const perAgentRunning = new Set<string>()', 'const perAgentRunning = new Set<string>() /* disabled */');
      src = src.replace('if (!queue.length || perAgentRunning.has(agentId)) continue', 'if (!queue.length) continue');
      src = src.replace('perAgentRunning.add(agentId)', 'void agentId');
      src = src.replace('perAgentRunning.delete(agentId)', 'void agentId');
      write(rel, src);
    },
    'tests/agentActivityApplyPython.test.cjs'
  )
);

check(
  'queue coalesce keeps stale position (ordering bug)',
  verify(
    'in-place coalesce',
    ['server/agentActivity/applyViaPython.ts'],
    (rel) => {
      const src = read(rel);
      write(
        rel,
        src.replace(
          `if (existingIdx >= 0) {
    queue.splice(existingIdx, 1)
  }
  queue.push({ projectRoot, event, key })`,
          `if (existingIdx >= 0) {
    queue[existingIdx] = { projectRoot, event, key }
  } else {
    queue.push({ projectRoot, event, key })
  }`
        )
      );
    },
    'tests/agentActivityApplyPython.test.cjs'
  )
);

check(
  'global cap removed',
  verify(
    'max concurrent',
    ['server/agentActivity/applyViaPython.ts'],
    (rel) => {
      write(rel, read(rel).replace('const MAX_CONCURRENT = 2', 'const MAX_CONCURRENT = 99'));
    },
    'tests/agentActivityApplyPython.test.cjs'
  )
);

check(
  'user-prompt event removed',
  verify(
    'userPrompt',
    ['server/agentActivity/claudeJsonlParser.ts'],
    (rel) => {
      const src = read(rel);
      write(rel, src.replace(/events\.push\(\{[\s\S]*?kind: 'userPrompt'[\s\S]*?\}\)\s*/m, ''));
    },
    'tests/agentActivityMutationGuards.test.cjs'
  )
);

check(
  'registry lock removed',
  verify(
    'registry lock',
    ['.cursor/hooks/hook-sessions-registry.cjs'],
    (rel) => {
      let src = read(rel);
      src = src.replace(/const release = acquireLock\(projectRoot\);[\s\S]*?continue;\s*\}/, 'const release = () => {};');
      write(rel, src);
    },
    'tests/agentActivityMutationGuards.test.cjs'
  )
);

check(
  'feed stop() guard removed',
  verify(
    'ActivityFeed stop guard',
    ['server/agentActivity/activityFeed.ts'],
    (rel) => {
      write(rel, read(rel).replace('if (!this.running) return\n    this.running = false', 'this.running = false'));
    },
    'tests/agentActivityLogMapping.test.cjs'
  )
);

console.log(`\n=== Mutation verification: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
