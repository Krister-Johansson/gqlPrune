// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// End-to-end cases for usage resolved through modules: the AST engine follows
// imports, re-exports, barrels, renamed, default and namespace imports to a
// name, and treats declarations, unread imports, comments, strings and object
// keys as what they are, not as references.
//
// Fixture:
//   resolution/  graphql/live holds eight operations each alive through one
//                kind of indirection (one consumer file per shape) and
//                graphql/dead seven whose names appear in src/dead in a shape
//                that is not a reference; src/Broken.ts carries a deliberate
//                syntax error and still holds a call

import {
  assertCliBuilt,
  expectJsonOnlyStdout,
  parseReport,
  runCli,
  type CliResult,
} from './helpers';

const SCAN = ['--graphql', 'resolution/graphql', '--src', 'resolution/src'];

const DEAD = [
  'GetCommentedName',
  'GetDeclaredOnly',
  'GetImportOnly',
  'GetNameInString',
  'GetNameReferenced',
  'GetObjectKey',
  'GetPatternInString',
];

let json: CliResult;
let verbose: CliResult;

beforeAll(async () => {
  assertCliBuilt();
  json = await runCli([...SCAN, '--json']);
  verbose = await runCli([...SCAN, '--verbose']);
});

describe('usage resolved through modules', () => {
  it('reports exactly the operations nothing references, and exits 1', () => {
    expectJsonOnlyStdout(json);
    const report = parseReport(json);

    expect(report.unusedOperations.map((op) => op.name).sort()).toEqual(DEAD);
    expect(json.code).toBe(1);
  });

  it.each([
    ['GetViaReexport', 'Reexport.tsx', 'GetViaReexportDocument'],
    ['GetViaBarrel', 'Barrel.tsx', 'useGetViaBarrelQuery'],
    ['GetViaRename', 'Rename.tsx', 'GetViaRenameDocument'],
    ['GetViaDefault', 'Default.tsx', 'GetViaDefaultDocument'],
    ['GetViaNamespace', 'Namespace.tsx', 'useGetViaNamespaceQuery'],
    ['GetViaCycle', 'Cycle.tsx', 'GetViaCycleDocument'],
    ['GetViaProperty', 'Property.ts', 'useGetViaPropertyQuery'],
    ['GetViaBroken', 'Broken.ts', 'useGetViaBrokenQuery'],
  ])('%s is used, and --verbose cites %s', (name, file, identifier) => {
    const line = verbose.stderr
      .split('\n')
      .find((entry) => entry.includes(`used:   ${name} (query)`));

    expect(line).toBeDefined();
    expect(line).toContain(`"${identifier}" referenced in`);
    expect(line).toContain(file);
  });

  it('explains the import chain of a name reached through a barrel', () => {
    const lines = verbose.stderr.split('\n');
    const used = lines.findIndex((entry) =>
      entry.includes('used:   GetViaBarrel (query)'),
    );

    expect(lines[used + 1]).toContain("via imported from './api'");
    expect(lines[used + 2]).toContain("via re-exported from './hooks'");
    expect(lines[used + 3]).toContain(
      "via re-exported from '../generated/graphql'",
    );
    expect(lines[used + 3]).toContain('outside the scanned files');
  });
});

describe('what is not a reference', () => {
  const grade = (name: string) => {
    const op = parseReport(json).unusedOperations.find(
      (entry) => entry.name === name,
    );
    return [op?.confidence, op?.reason];
  };

  it.each([
    ['an import that nothing reads', 'GetImportOnly'],
    ['a declaration of the pattern name', 'GetDeclaredOnly'],
    ['a comment', 'GetCommentedName'],
    ['a string holding the expanded pattern', 'GetPatternInString'],
    ['an object key', 'GetObjectKey'],
  ])('does not count %s', (_shape, name) => {
    expect(grade(name)).toEqual(['high', 'name-absent']);
  });

  it('grades an exact string literal of the bare name string-mention', () => {
    expect(grade('GetNameInString')).toEqual(['low', 'string-mention']);
  });

  it('grades a bare identifier reference name-referenced', () => {
    expect(grade('GetNameReferenced')).toEqual(['low', 'name-referenced']);
  });

  it('says so under --verbose', () => {
    expect(verbose.stderr).toContain(
      'confidence: operation "GetNameInString" is low (string-mention:',
    );
    expect(verbose.stderr).toContain(
      'confidence: operation "GetNameReferenced" is low (name-referenced:',
    );
  });
});

describe('a source file that does not parse', () => {
  it('warns, names the file, and keeps the references it could read', () => {
    const report = parseReport(json);

    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain('Broken.ts');
    expect(report.warnings[0]).toContain('syntax error');
    expect(report.unusedOperations.map((op) => op.name)).not.toContain(
      'GetViaBroken',
    );
  });

  it('is advisory: a clean run with such a file still exits 0', async () => {
    // Only the used half of the corpus, so nothing is unused and the warning
    // is the only thing the run has to say.
    const result = await runCli([
      '--graphql',
      'resolution/graphql/live',
      '--src',
      'resolution/src',
      '--json',
    ]);

    expect(result.code).toBe(0);
    expect(parseReport(result).warnings[0]).toContain('Broken.ts');
  });
});
