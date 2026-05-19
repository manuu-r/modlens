#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const GENERATED_CONFIG = '.devvit.generated.json';
const DEV_SEED_SETTING = 'modlensDevSeedActionsEnabled';
const DEV_SEED_MENU_ITEMS = [
  {
    label: '[DEV] Seed test data',
    description: 'Populate the queue, notes, and domains with fixture data for testing. Dev builds only.',
    forUserType: 'moderator',
    location: 'subreddit',
    endpoint: '/internal/menu/dev-seed',
  },
  {
    label: '[DEV] Clear seed data',
    description: 'Remove all fixture data seeded by the dev seed action.',
    forUserType: 'moderator',
    location: 'subreddit',
    endpoint: '/internal/menu/dev-clear',
  },
  {
    label: '[DEV] Seed status',
    description: 'Show how many seed fixtures are currently in Redis.',
    forUserType: 'moderator',
    location: 'subreddit',
    endpoint: '/internal/menu/dev-status',
  },
];

const [command, ...args] = process.argv.slice(2);
const devvitBin = process.platform === 'win32' ? 'node_modules/.bin/devvit.cmd' : 'node_modules/.bin/devvit';

if (!command) {
  console.error('Usage: node scripts/devvit-config.mjs <devvit-command> [...args]');
  process.exit(1);
}

const config = JSON.parse(await readFile('devvit.json', 'utf8'));
const seedEnabled = process.env.MODLENS_ENABLE_DEV_SEED === 'true';

if (seedEnabled) {
  config.menu ??= {};
  config.menu.items ??= [];
  const existingEndpoints = new Set(config.menu.items.map((item) => item.endpoint));
  for (const item of DEV_SEED_MENU_ITEMS) {
    if (!existingEndpoints.has(item.endpoint)) {
      config.menu.items.push(item);
    }
  }
  config.settings ??= {};
  config.settings.global ??= {};
  config.settings.global[DEV_SEED_SETTING] ??= {
    type: 'boolean',
    label: 'Enable dev seed actions',
    helpText: 'Development-only guard for fixture seed, clear, and status menu actions.',
    defaultValue: true,
  };
}

await writeFile(GENERATED_CONFIG, `${JSON.stringify(config, null, 2)}\n`);

const child = spawn(devvitBin, [command, '--config', GENERATED_CONFIG, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
