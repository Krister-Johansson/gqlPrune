// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { COMMANDS, FLAGS, SHELLS } from '../src/utils/args';
import type { FlagSpec, Shell } from '../src/utils/args';
import { completionScript, isShell } from '../src/utils/completions';

/**
 * How each shell spells a long flag in its completion script. Driving the
 * assertions off the FLAGS table (rather than a hard-coded list) is the point:
 * a flag added to the table without a matching script entry fails the suite.
 */
const longFlag: Record<Shell, (spec: FlagSpec) => string> = {
  bash: (spec) => spec.flag,
  zsh: (spec) => spec.flag,
  fish: (spec) => `-l ${spec.flag.replace(/^--/, '')}`,
};

const shortFlag: Record<Shell, (alias: string) => string> = {
  bash: (alias) => alias,
  zsh: (alias) => alias,
  fish: (alias) => `-s ${alias.replace(/^-/, '')}`,
};

/** The construct that hands value completion back to the shell's file picker. */
const fileCompletion: Record<Shell, string> = {
  bash: 'compgen -A file',
  zsh: '_files',
  fish: '-F',
};

describe('isShell', () => {
  it('accepts every supported shell', () => {
    for (const shell of SHELLS) expect(isShell(shell)).toBe(true);
  });

  it('rejects an unsupported or missing shell', () => {
    expect(isShell('ksh')).toBe(false);
    expect(isShell('')).toBe(false);
    expect(isShell(undefined)).toBe(false);
  });
});

describe.each(SHELLS)('completionScript(%s)', (shell) => {
  const script = completionScript(shell);

  it('mentions every long flag from the FLAGS table', () => {
    for (const spec of FLAGS) {
      expect(script).toContain(longFlag[shell](spec));
    }
  });

  it('mentions every short alias from the FLAGS table', () => {
    for (const spec of FLAGS) {
      if (spec.alias === undefined) continue;
      expect(script).toContain(shortFlag[shell](spec.alias));
    }
  });

  it('completes every command from the COMMANDS table', () => {
    for (const spec of COMMANDS) expect(script).toContain(spec.name);
  });

  it('completes the shell names for the completion command', () => {
    for (const value of SHELLS) expect(script).toContain(value);
  });

  it('falls back to file completion for path-valued flags', () => {
    expect(FLAGS.some((spec) => spec.valueKind === 'path')).toBe(true);
    expect(script).toContain(fileCompletion[shell]);
  });

  it('registers the completion for the gqlprune command', () => {
    expect(script).toMatch(/gqlprune/);
  });

  it('leaves no placeholder tokens in the generated script', () => {
    expect(script).not.toContain('undefined');
    expect(script).not.toContain('null');
    expect(script).not.toContain('[object Object]');
  });

  it('documents how to install itself', () => {
    expect(script).toContain('gqlprune completion ' + shell);
  });

  it('is stable across calls', () => {
    expect(completionScript(shell)).toBe(script);
  });
});

describe('completionScript registration', () => {
  it('registers a bash completion function', () => {
    expect(completionScript('bash')).toContain(
      'complete -F _gqlprune_complete gqlprune',
    );
  });

  it('registers a zsh completion function through compdef', () => {
    expect(completionScript('zsh')).toContain('compdef _gqlprune gqlprune');
  });

  it('registers fish completions through complete -c', () => {
    expect(completionScript('fish')).toContain('complete -c gqlprune');
  });

  it('offers the shell names as the completion command argument', () => {
    const shells = [...SHELLS].join(' ');
    expect(completionScript('bash')).toContain(`compgen -W "${shells}"`);
    expect(completionScript('zsh')).toContain(`_values 'shell' ${shells}`);
    expect(completionScript('fish')).toContain(`-a '${shells}'`);
  });

  it('offers --fields as a switch in every shell', () => {
    // Boolean, so it appears in the flag list but never asks for a value.
    expect(completionScript('bash')).toContain('--fields');
    expect(completionScript('zsh')).toContain('(--fields)--fields[');
    expect(completionScript('fish')).toContain('-l fields');
    expect(completionScript('fish')).not.toContain('-l fields -r');
  });

  it('offers --inline as a switch in every shell', () => {
    // Boolean like --fields, so it never asks the shell for a value.
    expect(completionScript('bash')).toContain('--inline');
    expect(completionScript('zsh')).toContain('(--inline)--inline[');
    expect(completionScript('fish')).toContain('-l inline');
    expect(completionScript('fish')).not.toContain('-l inline -r');
  });

  it('completes nothing for value flags without a path value', () => {
    // --pattern takes a free-form template; the shell should not offer files.
    const bash = completionScript('bash');
    const opaque = FLAGS.filter(
      (spec) => spec.takesValue && spec.valueKind !== 'path',
    ).map((spec) => spec.flag);
    expect(opaque.length).toBeGreaterThan(0);
    expect(bash).toContain(opaque.join('|'));
  });
});
