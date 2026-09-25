#!/usr/bin/env node
/** Forward hook stdin to Dashboard live-status (works from any Cursor workspace). */
const { spawnSync } = require('child_process');
const { readStdin } = require('/Users/aaron/.cursor/hooks/adapter');

const STATUS_SCRIPT =
  '/Users/aaron/Documents/Projecten/Cursor Projects/Dashboard/.cursor/hooks/update-dashboard-status.py';

readStdin()
  .then((raw) => {
    const event = process.argv[2] || 'unknown';
    spawnSync('python3', [STATUS_SCRIPT, event], {
      input: raw,
      encoding: 'utf-8',
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    process.stdout.write(raw);
  })
  .catch(() => process.exit(0));
