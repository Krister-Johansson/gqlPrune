// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLAGS } from '../src/utils/args.js';

// The user docs in docs/ describe the CLI by hand. These tests tie the
// reference pages to the code they describe, the same way FLAGS already feeds
// the parser, the help text and the completion scripts: a flag, config key,
// confidence reason or JSON report key that the docs lose fails the suite.

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Every Markdown heading line of a page. */
function headingsOf(page: string): string[] {
  return read(page)
    .split('\n')
    .filter((line) => /^#{1,6}\s/.test(line));
}

/** The member names of an interface in a .d.ts file. */
function interfaceKeys(file: string, name: string): string[] {
  const source = read(file);
  const start = source.indexOf(`export interface ${name} {`);
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end);
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1]);
}

/** The string members of a union type alias in a .d.ts file. */
function unionMembers(file: string, name: string): string[] {
  const source = read(file);
  const start = source.indexOf(`export type ${name} =`);
  const end = source.indexOf(';', start);
  return [...source.slice(start, end).matchAll(/'([^']+)'/g)].map(
    (match) => match[1],
  );
}

/** Every key the contract spec pins with `keysOf(...)).toEqual([...])`. */
function contractKeys(): string[] {
  const source = read('test/e2e/contract.e2e.test.ts');
  const keys = new Set<string>();
  for (const block of source.matchAll(
    /keysOf\([^)]*\)\)\.toEqual\(\[([^\]]*)\]/g,
  )) {
    for (const key of block[1].matchAll(/'([^']+)'/g)) keys.add(key[1]);
  }
  return [...keys];
}

describe('docs/reference/cli.mdx', () => {
  const headings = headingsOf('docs/reference/cli.mdx');

  it.each(FLAGS.map((spec) => spec.flag))('has a heading for %s', (flag) => {
    expect(headings.some((line) => line.includes(`\`${flag}\``))).toBe(true);
  });
});

describe('docs/configuration/config-file.mdx', () => {
  const headings = headingsOf('docs/configuration/config-file.mdx');
  const keys = interfaceKeys('src/types/GqlPruneConfig.d.ts', 'GqlPruneConfig');

  it('reads the config keys from the type', () => {
    expect(keys).toContain('graphqlDir');
    expect(keys).toContain('usagePatterns');
  });

  it.each(keys)('has a heading for %s', (key) => {
    expect(headings.some((line) => line.includes(`\`${key}\``))).toBe(true);
  });
});

describe('docs/concepts/confidence.mdx', () => {
  const headings = headingsOf('docs/concepts/confidence.mdx');
  const reasons = unionMembers('src/types/Confidence.d.ts', 'ConfidenceReason');

  it('reads the reasons from the type', () => {
    expect(reasons).toContain('name-absent');
  });

  it.each(reasons)('has a heading for the %s reason', (reason) => {
    expect(headings.some((line) => line.includes(reason))).toBe(true);
  });
});

describe('docs/reference/json-report.mdx', () => {
  const page = read('docs/reference/json-report.mdx');
  const keys = contractKeys();

  it('reads the pinned keys from the contract spec', () => {
    expect(keys).toContain('unusedOperations');
    expect(keys).toContain('byConfidence');
  });

  it.each(keys)('mentions the %s key', (key) => {
    expect(page).toContain(`\`${key}\``);
  });
});
