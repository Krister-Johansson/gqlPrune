#!/usr/bin/env node
import kleur from 'kleur';
import { generateConfig } from './core/configGenerator.js';
import { mainFunction } from './core/gqlPruner.js';
import { formatHelp, parseArgs } from './utils/args.js';
import { notifyUpdate } from './utils/updateNotifier.js';
import { pkg } from './utils/pkgInfo.js';

const { command, json, annotate, version, verbose, help, errors, config } =
  parseArgs(process.argv.slice(2));

/** Prints usage errors and the --help pointer; the run is aborted. */
function reportUsageErrors(lines: string[]): void {
  for (const line of lines) {
    console.error(kleur.red(line));
  }
  console.error('Run "gqlprune --help" for usage.');
  process.exitCode = 1;
}

async function run(): Promise<void> {
  if (errors.length > 0) {
    reportUsageErrors(errors);
    return;
  }

  if (help) {
    console.log(formatHelp());
    return;
  }

  if (version) {
    console.log(pkg.version);
    return;
  }

  if (command !== undefined && command !== 'init') {
    reportUsageErrors([`Unknown command: ${command}`]);
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
