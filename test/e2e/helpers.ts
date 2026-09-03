// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// Shared plumbing for the end-to-end suite: it runs the *built* CLI as a real
// process, so everything here deals in paths, argv, environment and exit codes
// rather than module mocks.

import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Repository root, from `test/e2e/`. */
export const repoRoot = path.resolve(__dirname, '..', '..');

/** The compiled entry point the suite executes. */
export const cliPath = path.join(repoRoot, 'dist', 'cli.js');

/** The static project tree every scan case runs against. */
export const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'e2e');

/**
 * The absolute path of one fixture sub-project.
 *
 * Several scenarios need a working directory of their own, because both
 * `gqlPrune.config.yaml` and the GraphQL Code Generator config are looked up in
 * the process's cwd. Running such a case from the fixture root would let one
 * project's config decide another project's scan.
 */
export function fixtureProject(...segments: string[]): string {
  return path.join(fixtureRoot, ...segments);
}

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

/** How long stdout must stay quiet before the next prompt answer is sent. */
const PROMPT_SETTLE_MS = 150;

/**
 * Runs the built CLI and answers its interactive prompts, for `gqlprune init`.
 *
 * Piping the answers in one go does not work: inquirer treats the closed stdin
 * as an aborted prompt and the run ends with "Aborted." before it has asked
 * anything. So the stream is kept open and each answer is written only once
 * stdout has gone quiet, which is inquirer having finished rendering the next
 * question. That is also why the answers cannot simply be timed: a slow runner
 * would receive them before the prompt exists.
 *
 * @param {string[]} args - Arguments for the CLI, e.g. `['init']`.
 * @param {object} options - The working directory and the answers, in order.
 * @returns {Promise<CliResult>} - Exit code and captured streams.
 */
export function runCliInteractive(
  args: string[],
  options: { cwd: string; answers: string[] },
): Promise<CliResult> {
  assertCliBuilt();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: '1', NO_UPDATE_NOTIFIER: '1' },
    });
    const pending = [...options.answers];
    let stdout = '';
    let stderr = '';
    let settle: NodeJS.Timeout | undefined;

    const answerWhenQuiet = (): void => {
      if (settle !== undefined) clearTimeout(settle);
      settle = setTimeout(() => {
        const answer = pending.shift();
        if (answer !== undefined) child.stdin.write(`${answer}\n`);
      }, PROMPT_SETTLE_MS);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      answerWhenQuiet();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (settle !== undefined) clearTimeout(settle);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

/**
 * The `--json` report, typed as the suite reads it. Deliberately structural: the
 * contract spec pins the real shape, and these fields are what the scan cases
 * query key by key.
 */
export type JsonReport = {
  unusedOperations: {
    name: string;
    type: string;
    file: string;
    line?: number;
    confidence: string;
    reason: string;
  }[];
  unusedFragments: {
    name: string;
    file: string;
    line?: number;
    confidence: string;
    reason: string;
  }[];
  orphanedFiles: { file: string; confidence: string; reason: string }[];
  deprecatedUsages: { message: string; file: string; line?: number }[];
  unusedFields?: {
    field: string;
    locations: { file: string; line?: number }[];
    confidence: string;
    reason: string;
  }[];
  warnings: string[];
  summary: Record<string, number> & {
    byConfidence: Record<string, number>;
  };
};

/** Parses stdout as the JSON report, failing loudly on anything else. */
export function parseReport(result: CliResult): JsonReport {
  try {
    return JSON.parse(result.stdout) as JsonReport;
  } catch {
    throw new Error(
      `Expected stdout to be a JSON document, got:\n${result.stdout}`,
    );
  }
}

/**
 * Asserts the whole of stdout is the JSON document and nothing else. A stray
 * info line or warning ahead of it would break every consumer piping this into
 * jq, so this is checked wherever `--json` is exercised.
 */
export function expectJsonOnlyStdout(result: CliResult): void {
  const trimmed = result.stdout.trimEnd();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error(
      `Expected stdout to hold only JSON, got:\n${result.stdout}`,
    );
  }
  parseReport(result);
}

/** The 1-based line a fixture file's first match for `needle` sits on. */
export function lineOf(filePath: string, needle: string): number {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const index = lines.findIndex((line) => line.includes(needle));
  if (index === -1) {
    throw new Error(
      `${filePath} contains no line with ${JSON.stringify(needle)}`,
    );
  }
  return index + 1;
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
