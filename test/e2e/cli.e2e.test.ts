// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// End-to-end cases: every one of these spawns `node dist/cli.js` and inspects
// what a user would see — stdout, stderr, and the exit code. The unit suite
// mocks the filesystem and never runs the CLI as a process, so this layer is
// where the shipped artifact, the stream discipline and the exit-code contract
// are actually exercised.
//
// This file covers the core scan. The projects it uses, under
// test/fixtures/e2e/:
//
//   app/       one used query, one dead query (a whole orphaned file), a dead
//              fragment kept off the orphan list by an #import, a deprecated
//              selection, and one field nothing in app/src names
//   clean/     nothing unused; used for the exit-0 and advisory-only cases
//   masked/    six operations plus a codegen-shaped graphql.ts covering all of
//              them, which is what the masking warning is about
//   packages/  two workspaces, for `packages/*/graphql` glob expansion
//   schema.graphql / schema-invalid.graphql
//
// The rest of the fixture tree belongs to the other spec files, each of which
// documents its own projects: inline.e2e.test.ts (inline/, inline-fragments/),
// codegen.e2e.test.ts (codegen/*), confidence.e2e.test.ts (confidence/,
// confidence-low/, bad-config/), interactions.e2e.test.ts and
// contract.e2e.test.ts (combined/).
//
// On assertions: the human report is checked for section headers, their
// relative order and the names of specific findings — never whole-output
// equality, because columns and header lines get added to it over time. The
// JSON report is parsed and queried key by key for the same reason. Exit codes
// and `--json` stdout purity are pinned exactly; those are stable contracts.

import {
  assertCliBuilt,
  expectInOrder,
  parseReport,
  runCli,
  toPosix,
  type CliResult,
} from './helpers';

const APP_SCAN = ['--graphql', 'app/graphql', '--src', 'app/src'];
const CLEAN_SCAN = ['--graphql', 'clean/graphql', '--src', 'clean/src'];
const MASKED_SCAN = ['--graphql', 'masked/graphql', '--src', 'masked/src'];
const GLOB_SCAN = [
  '--graphql',
  'packages/*/graphql',
  '--src',
  'packages/*/src',
];

beforeAll(() => {
  assertCliBuilt();
});

describe('a clean project', () => {
  it('reports the all-clear and exits 0', async () => {
    const result = await runCli(CLEAN_SCAN);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'No unused GraphQL operations or fragments found.',
    );
    expect(result.stdout).not.toContain('--- Unused GraphQL Operations ---');
  });
});

describe('a project with findings', () => {
  let result: CliResult;

  beforeAll(async () => {
    result = await runCli([
      ...APP_SCAN,
      '--schema',
      'schema.graphql',
      '--fields',
    ]);
  });

  it('exits 1', () => {
    expect(result.code).toBe(1);
  });

  it('prints every section in report order, closing with the reminder', () => {
    expectInOrder(result.stdout, [
      '--- Unused GraphQL Operations ---',
      '--- Unused GraphQL Fragments ---',
      '--- Orphaned GraphQL Files ---',
      '--- Deprecated Field Usage ---',
      '--- Unused Field Candidates ---',
      'These are candidates from a string search.',
    ]);
  });

  it('names the dead operation, the dead fragment and the orphaned file', () => {
    // Presence, not position: each of these also appears in the File column of
    // an earlier section, so their first occurrence carries no meaning.
    expect(result.stdout).toContain('GetLegacyReport');
    expect(result.stdout).toContain('AbandonedTeaserFields');
    expect(result.stdout).toContain('app/graphql/legacyReport.gql');
    expect(result.stdout).toContain('internalAuditTrail');
  });
});

describe('--json', () => {
  it('puts nothing but the report on stdout', async () => {
    const result = await runCli([...APP_SCAN, '--json']);

    // The whole stream, byte for byte, has to be the JSON document: a stray
    // info line or warning ahead of it would break every consumer piping this
    // into jq. Everything human-readable belongs on stderr.
    expect(result.stdout.trimEnd().startsWith('{')).toBe(true);
    expect(result.stdout.trimEnd().endsWith('}')).toBe(true);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.code).toBe(1);
  });

  it('reports the findings and their counts', async () => {
    const report = parseReport(await runCli([...APP_SCAN, '--json']));

    expect(report.unusedOperations.map((op) => op.name)).toEqual([
      'GetLegacyReport',
    ]);
    expect(report.unusedFragments.map((fragment) => fragment.name)).toEqual([
      'AbandonedTeaserFields',
    ]);
    expect(report.orphanedFiles.map((orphan) => toPosix(orphan.file))).toEqual([
      'app/graphql/legacyReport.gql',
    ]);
    expect(report.summary.unusedOperations).toBe(1);
    expect(report.summary.unusedFragments).toBe(1);
    expect(report.summary.orphanedFiles).toBe(1);
  });

  it('keeps an imported file off the orphan list', async () => {
    const report = parseReport(await runCli([...APP_SCAN, '--json']));

    // teaserFields.gql holds nothing but the dead fragment, so only the
    // `#import` in user.gql saves it from being called orphaned.
    expect(
      report.orphanedFiles.map((orphan) => toPosix(orphan.file)),
    ).not.toContain('app/graphql/fragments/teaserFields.gql');
  });
});

describe('a suspected generated file', () => {
  it('warns on stderr and in the JSON warnings, without failing the run', async () => {
    const result = await runCli([...MASKED_SCAN, '--json']);
    const report = parseReport(result);

    expect(result.stderr).toContain('Suspected generated file');
    expect(result.stderr).toContain('graphql.ts');
    expect(
      report.warnings.filter(
        (warning) =>
          warning.includes('Suspected generated file') &&
          warning.includes('graphql.ts'),
      ),
    ).toHaveLength(1);
    // The warning is advisory: the masked scan itself found nothing unused.
    expect(result.code).toBe(0);
  });
});

describe('--annotate', () => {
  it('emits ::warning workflow commands on stderr', async () => {
    const result = await runCli([...APP_SCAN, '--annotate']);
    const annotations = result.stderr
      .split('\n')
      .filter((line) => line.startsWith('::warning '));

    expect(result.code).toBe(1);
    expect(
      annotations.some((line) =>
        /^::warning file=app\/graphql\/legacyReport\.gql,line=\d+::.*GetLegacyReport/.test(
          line,
        ),
      ),
    ).toBe(true);
    expect(
      annotations.some((line) =>
        /^::warning file=\S+teaserFields\.gql,line=\d+::.*AbandonedTeaserFields/.test(
          line,
        ),
      ),
    ).toBe(true);
    // Annotations must never leak into stdout, which --json shares.
    expect(result.stdout).not.toContain('::warning');
  });
});

describe('--schema', () => {
  it('adds the advisory section without changing the exit code', async () => {
    const result = await runCli([...CLEAN_SCAN, '--schema', 'schema.graphql']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--- Deprecated Field Usage ---');
    expect(result.stdout).toContain('Ping.legacyLatencyMs is deprecated');
  });

  it('exits 2 on an SDL it cannot parse', async () => {
    const result = await runCli([
      ...CLEAN_SCAN,
      '--schema',
      'schema-invalid.graphql',
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      'Could not read or parse the GraphQL schema file',
    );
  });
});

describe('--fields', () => {
  it('lists the candidate only when asked for it', async () => {
    const off = parseReport(await runCli([...APP_SCAN, '--json']));
    const on = parseReport(await runCli([...APP_SCAN, '--json', '--fields']));

    // Absent, not empty: a consumer has to be able to tell "nothing found"
    // from "never looked".
    expect(off).not.toHaveProperty('unusedFields');
    expect(on.unusedFields?.map((candidate) => candidate.field)).toEqual([
      'internalAuditTrail',
    ]);
  });
});

describe('directory globs', () => {
  it('expands packages/*/graphql across every workspace', async () => {
    const result = await runCli([...GLOB_SCAN, '--json']);
    const report = parseReport(result);

    expect(result.code).toBe(1);
    // One finding from each workspace, so both sides of the glob were scanned.
    expect(report.unusedOperations.map((op) => op.name).sort()).toEqual([
      'GetBillingLedgerSnapshot',
      'GetOrdersArchiveSnapshot',
    ]);
  });

  it('exits 2 when a pattern matches no directory', async () => {
    const result = await runCli([
      '--graphql',
      'packages/*/nope',
      '--src',
      'app/src',
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('match no directories');
  });
});

describe('--exclude', () => {
  // The masked project's pretend-codegen/graphql.ts references every operation,
  // so excluding it is what lets the dead ones surface. All four spellings name
  // that one directory; before the matcher tested whole paths, three of them
  // quietly excluded nothing and the run reported a clean project.
  it.each([
    ['a trailing glob', 'masked/src/pretend-codegen/**'],
    ['a "./" prefix', './masked/src/pretend-codegen'],
    ['a trailing slash', 'masked/src/pretend-codegen/'],
    ['a bare folder name', 'pretend-codegen'],
  ])(
    'takes the masking file out of the scan, written as %s',
    async (_label, pattern) => {
      const result = await runCli([
        ...MASKED_SCAN,
        '--exclude',
        pattern,
        '--json',
      ]);
      const report = parseReport(result);

      expect(result.code).toBe(1);
      expect(report.unusedOperations.map((op) => op.name).sort()).toEqual([
        'GetCatalogFacets',
        'GetCatalogItem',
        'GetInventoryAlerts',
        'GetInventoryLevels',
        'UpdateCatalogItem',
      ]);
    },
  );

  it('scans the masking file when nothing excludes it', async () => {
    const result = await runCli([...MASKED_SCAN, '--json']);

    expect(result.code).toBe(0);
    expect(parseReport(result).unusedOperations).toEqual([]);
  });
});

describe('a directory pattern ending in **', () => {
  it('scans the directory it names, not only its subdirectories', async () => {
    // packages/*/src holds the files that prove both workspaces' operations
    // alive; "packages/*/src/**" must still reach them, not just any nested
    // folder underneath.
    const withGlob = await runCli([
      '--graphql',
      'packages/*/graphql',
      '--src',
      'packages/*/src/**',
      '--json',
    ]);
    const plain = await runCli([...GLOB_SCAN, '--json']);

    expect(parseReport(withGlob).unusedOperations.map((op) => op.name)).toEqual(
      parseReport(plain).unusedOperations.map((op) => op.name),
    );
  });
});

describe('whole-word usage matching', () => {
  const WHOLE_WORD = [
    '--graphql',
    'whole-word/graphql',
    '--src',
    'whole-word/src',
    '--json',
  ];

  it('does not let a longer identifier vouch for a shorter operation', async () => {
    // The source names GetWholeWordUserDocument and nothing else. The shorter
    // operation's pattern, WholeWordUserDocument, sits inside that identifier,
    // and a substring test judged the dead operation alive because of it.
    const report = parseReport(await runCli(WHOLE_WORD));

    expect(report.unusedOperations.map((op) => op.name)).toEqual([
      'WholeWordUser',
    ]);
  });

  it('still counts the operation the identifier really names', async () => {
    const report = parseReport(await runCli(WHOLE_WORD));

    expect(report.unusedOperations.map((op) => op.name)).not.toContain(
      'GetWholeWordUser',
    );
  });
});

describe('usage errors', () => {
  it('exits 2 on an unknown flag', async () => {
    const result = await runCli(['--nope']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown flag: --nope');
    expect(result.stdout).toBe('');
  });

  it('exits 2 on an unknown command', async () => {
    const result = await runCli(['bogus']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown command: bogus');
    expect(result.stdout).toBe('');
  });
});
