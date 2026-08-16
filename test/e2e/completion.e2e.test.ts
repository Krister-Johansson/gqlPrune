// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// The completion scripts are generated from the flag/command tables, so a table
// change can produce output that no longer parses. Here each script is handed
// to the shell it targets for a syntax-only check.
//
// bash is present on every supported platform and every runner, so its check
// always runs. zsh may not be installed, and fish rarely is: those cases fall
// back rather than fail, because a missing shell says nothing about gqlPrune.

import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertCliBuilt, runCli } from './helpers';

/** Whether a shell is on PATH and runnable. */
function hasShell(shell: string): boolean {
  const probe = spawnSync(shell, ['--version'], { stdio: 'ignore' });
  return probe.error === undefined && probe.status === 0;
}

let workDir: string;

beforeAll(() => {
  assertCliBuilt();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gqlprune-completion-'));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

/** Writes a generated script to disk and returns its path. */
async function writeScript(shell: string): Promise<string> {
  const result = await runCli(['completion', shell]);

  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout.length).toBeGreaterThan(0);

  const file = path.join(workDir, `gqlprune.${shell}`);
  fs.writeFileSync(file, result.stdout);
  return file;
}

describe('completion scripts', () => {
  it('emits a bash script that bash can parse', async () => {
    const file = await writeScript('bash');

    expect(() =>
      execFileSync('bash', ['-n', file], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('emits a zsh script that zsh can parse', async () => {
    const file = await writeScript('zsh');

    if (!hasShell('zsh')) {
      // No zsh on this machine; the script was still generated and captured.
      console.warn('zsh not installed — skipping the zsh syntax check.');
      return;
    }
    expect(() =>
      execFileSync('zsh', ['-n', file], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('emits a structurally complete fish script', async () => {
    // fish has no widely available syntax-only mode and is almost never on a
    // runner, so this one is checked structurally: it must register the
    // command, its subcommands and its flags.
    const result = await runCli(['completion', 'fish']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('complete -c gqlprune -f');
    expect(result.stdout).toContain("-a 'completion'");
    expect(result.stdout).toContain('-l graphql');
    expect(result.stdout).toContain('-l json');
  });

  it('exits 2 for a shell it does not support', async () => {
    const result = await runCli(['completion', 'nushell']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unsupported shell: nushell');
  });
});
