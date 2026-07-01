#!/usr/bin/env node
import { generateConfig } from './core/configGenerator.js';
import { mainFunction } from './core/gqlPruner.js';
import { parseArgs } from './utils/args.js';
import { notifyUpdate } from './utils/updateNotifier.js';
import { pkg } from './utils/pkgInfo.js';

const { command, json, annotate, version, verbose, config } = parseArgs(
  process.argv.slice(2),
);

async function run(): Promise<void> {
  if (version) {
    console.log(pkg.version);
    return;
  }

  if (command === 'init') {
    await generateConfig();
  } else {
    mainFunction({
      json,
      annotate: annotate || process.env.GITHUB_ACTIONS === 'true',
      verbose,
      config,
    });
  }

  // After the main work: a cached, stderr-only nudge if a newer version exists.
  await notifyUpdate(pkg, { json });
}

void run();
