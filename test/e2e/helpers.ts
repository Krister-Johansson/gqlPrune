// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// Shared plumbing for the end-to-end suite: it runs the *built* CLI as a real
// process, so everything here deals in paths, argv, environment and exit codes
// rather than module mocks.

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Repository root, from `test/e2e/`. */
export const repoRoot = path.resolve(__dirname, '..', '..');

/** The compiled entry point the suite executes. */
export const cliPath = path.join(repoRoot, 'dist', 'cli.js');

/** The static project tree every scan case runs against. */
export const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'e2e');

/**
 * Fails with an actionable message when the CLI has not been built. Without
 * this the first case would report a bare MODULE_NOT_FOUND from node, which
 * says nothing about the missing build step.
 */
export function assertCliBuilt(): void {
  if (!fs.existsSync(cliPath)) {
    throw new Error(
      `The e2e suite runs the built CLI, but ${cliPath} does not exist. ` +
        'Run "npm run build" first, or use "npm run test:e2e", which builds.',
    );
  }
}

/** One CLI invocation's observable result. */
export type CliResult = {
  /** Exact process exit code: 0 clean, 1 findings, 2 usage/config failure. */
  code: number;
  stdout: string;
  stderr: string;
};

/**
 * The environment every case runs under. Pinned so a developer's terminal and
 * a GitHub runner produce the same bytes: no ANSI colour, no update-check line,
 * and no implicit `--annotate` from `GITHUB_ACTIONS`.
 */
function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    NO_UPDATE_NOTIFIER: '1',
    ...extra,
  };
  delete env.GITHUB_ACTIONS;
  delete env.FORCE_COLOR;
  return env;
}

/**
 * Runs an executable and resolves with its exit code and captured streams. A
 * non-zero exit is a normal outcome here, so only a genuine spawn failure
 * (a missing binary, say) rejects.
 */
export function runProcess(
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd ?? fixtureRoot,
        env: childEnv(options.env),
        maxBuffer: 10 * 1024 * 1024,
        // Windows shims (`npm.cmd`, `gqlprune.cmd`) are batch files and need a
        // shell; the posix paths are executed directly, which is what puts the
        // shebang under test.
        shell: options.shell ?? false,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error);
          return;
        }
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr });
      },
    );
  });
}

/**
 * Runs the built CLI with the given arguments, from the fixture root unless a
 * different working directory is given (the config file is looked up relative
 * to the process's cwd, so this matters).
 */
export function runCli(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CliResult> {
  assertCliBuilt();
  return runProcess(process.execPath, [cliPath, ...args], options);
}

/**
 * Asserts that every marker appears in `text`, in the given order.
 *
 * Deliberately weaker than comparing whole output: the human report gains
 * columns and header lines over time, and a suite that pins every byte would
 * have to be rewritten for each of those. Section order and the presence of a
 * named finding are the contract worth holding.
 */
export function expectInOrder(text: string, markers: string[]): void {
  let previous = -1;
  let previousMarker = '';
  for (const marker of markers) {
    const at = text.indexOf(marker);
    if (at === -1) {
      throw new Error(`Expected output to contain ${JSON.stringify(marker)}`);
    }
    if (at < previous) {
      throw new Error(
        `Expected ${JSON.stringify(marker)} to come after ` +
          `${JSON.stringify(previousMarker)} in the output`,
      );
    }
    previous = at;
    previousMarker = marker;
  }
}

/** Normalises a reported path so assertions read the same on every platform. */
export function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
