#!/usr/bin/env node
import kleur from 'kleur';
import { generateConfig } from './core/configGenerator.js';
import { escapeAnnotationMessage, mainFunction } from './core/gqlPruner.js';
import { formatHelp, parseArgs } from './utils/args.js';
import { notifyUpdate } from './utils/updateNotifier.js';
import { pkg } from './utils/pkgInfo.js';

const { command, json, annotate, version, verbose, help, errors, config } =
  parseArgs(process.argv.slice(2));
const annotateMode = annotate || process.env.GITHUB_ACTIONS === 'true';

/**
 * Prints usage errors and the --help pointer; the run is aborted. In CI /
 * --annotate mode each error is an (escaped) ::error workflow command so it
 * surfaces in the Actions UI instead of only in the raw log.
 */
function reportUsageErrors(lines: string[]): void {
  for (const line of lines) {
    console.error(
      annotateMode
        ? `::error::${escapeAnnotationMessage(line)}`
        : kleur.red(line),
    );
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
      annotate: annotateMode,
      verbose,
      config,
    });
  }

  // After the main work: a cached, stderr-only nudge if a newer version exists.
  await notifyUpdate(pkg, { json });
}

run().catch((error: unknown) => {
  // Inquirer rejects with an ExitPromptError when the user aborts a prompt
  // (Ctrl+C) — a deliberate exit, not a crash worth a stack trace.
  if (error instanceof Error && error.name === 'ExitPromptError') {
    console.error('Aborted.');
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
