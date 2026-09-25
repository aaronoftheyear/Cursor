#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const tsxBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
const viteConfigPath = path.join(PROJECT_ROOT, 'vite.config.ts');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    failed++;
  }
}

test('vite config does not return teardown from configureServer', () => {
  const src = fs.readFileSync(viteConfigPath, 'utf-8');
  const configureBlock = src.slice(src.indexOf('configureServer(server)'));
  const previewIdx = configureBlock.indexOf('configurePreviewServer');
  const serverBlock = previewIdx > 0 ? configureBlock.slice(0, previewIdx) : configureBlock;
  if (/return\s*\(\s*\)\s*=>\s*\{[^}]*dashboardActivityFeed\?\.stop/.test(serverBlock)) {
    throw new Error('configureServer must not return a function that stops the feed');
  }
  if (!serverBlock.includes("httpServer?.once('close'")) {
    throw new Error('expected httpServer close handler');
  }
});

test('activity feed still running after configureServer completes', () => {
  const script = `
    import viteConfig from '${PROJECT_ROOT}/vite.config.ts';
    import { getDashboardActivityFeedForTests } from '${PROJECT_ROOT}/vite.config.ts';

    const config = viteConfig({ mode: 'development', command: 'serve' });
    const plugin = config.plugins.find((p) => p && p.name === 'dashboard-live-status');
    if (!plugin?.configureServer) throw new Error('missing plugin');

    const closeHandlers = [];
    const mockServer = {
      middlewares: { use() {} },
      httpServer: {
        once(ev, fn) {
          if (ev === 'close') closeHandlers.push(fn);
        },
      },
    };

    plugin.configureServer(mockServer);
    const feed = getDashboardActivityFeedForTests();
    const running = feed?.isRunning() === true;
    const polling = feed?.isSessionLogPolling() === true;
    feed?.stop();
    console.log(JSON.stringify({ running, polling, closeHandlers: closeHandlers.length }));
  `;
  const raw = execFileSync(tsxBin, ['--eval', script], { encoding: 'utf-8', cwd: PROJECT_ROOT });
  const out = JSON.parse(raw.trim().split('\n').filter(Boolean).pop());
  if (!out.running) throw new Error('feed should be running after configureServer');
  if (!out.polling) throw new Error('session log poller should be active');
  if (out.closeHandlers < 1) throw new Error('close handler not registered');
});

test('httpServer close stops feed and session log polling', () => {
  const script = `
    import viteConfig from '${PROJECT_ROOT}/vite.config.ts';
    import { getDashboardActivityFeedForTests } from '${PROJECT_ROOT}/vite.config.ts';

    const config = viteConfig({ mode: 'development', command: 'serve' });
    const plugin = config.plugins.find((p) => p && p.name === 'dashboard-live-status');
    const closeHandlers = [];
    const mockServer = {
      middlewares: { use() {} },
      httpServer: {
        once(ev, fn) {
          if (ev === 'close') closeHandlers.push(fn);
        },
      },
    };
    plugin.configureServer(mockServer);
    const feed = getDashboardActivityFeedForTests();
    const wasPolling = feed?.isSessionLogPolling() === true;
    for (const fn of closeHandlers) fn();
    const afterClose = {
      running: feed?.isRunning() === true,
      polling: feed?.isSessionLogPolling() === true,
      refNull: getDashboardActivityFeedForTests() === null,
    };
    console.log(JSON.stringify({ wasPolling, afterClose }));
  `;
  const raw = execFileSync(tsxBin, ['--eval', script], { encoding: 'utf-8', cwd: PROJECT_ROOT });
  const out = JSON.parse(raw.trim().split('\n').filter(Boolean).pop());
  if (!out.wasPolling) throw new Error('expected polling before close');
  if (out.afterClose.running) throw new Error('feed should not run after close');
  if (out.afterClose.polling) throw new Error('poller should stop after close');
  if (!out.afterClose.refNull) throw new Error('feed ref should be cleared');
});

console.log(`\n=== Vite activity feed: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
