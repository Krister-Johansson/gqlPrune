// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// The published contracts, pinned: the exact shape of the `--json` report and
// the exit code every outcome produces.
//
// This file is the deliberate exception to the suite's resilient assertion
// style. Everywhere else a report is queried key by key, so that adding a field
// does not rewrite the tests. Here the whole point is that adding, renaming or
// removing a key is a breaking change for every consumer, so the key sets are
// compared exactly. 3.0.0 turned each `orphanedFiles` entry from a string into
// an object; a spec like this one would have made that visible before release
// rather than in review.
//
// A failure here is not a test to fix. It is a contract change to decide on: if
// it is intended, it belongs in the release notes and in a major version.

import {
  assertCliBuilt,
  fixtureProject,
  parseReport,
  runCli,
  type JsonReport,
} from './helpers';

const combined = fixtureProject('combined');
const CLEAN_SCAN = ['--graphql', 'clean/graphql', '--src', 'clean/src'];

/** The keys of an object, sorted, for order-independent comparison. */
function keysOf(value: object): string[] {
  return Object.keys(value).sort();
}

beforeAll(() => {
  assertCliBuilt();
});

describe('the JSON report', () => {
  let full: JsonReport;

  beforeAll(async () => {
    // One scan that produces every entry kind at once: unused operations from
    // both corpora, orphaned files, a deprecated selection and a field
    // candidate. Anything absent here would be pinned by its absence instead.
    full = parseReport(
      await runCli(
        ['--inline', '--fields', '--schema', './schema.graphql', '--json'],
        { cwd: combined },
      ),
    );
  });

  it('has exactly these top-level keys', () => {
    expect(keysOf(full)).toEqual([
      'deprecatedUsages',
      'orphanedFiles',
      'summary',
      'unusedFields',
      'unusedFragments',
      'unusedOperations',
      'warnings',
    ]);
  });

  it('omits unusedFields entirely when the check did not run', async () => {
    const withoutFields = parseReport(
      await runCli(['--inline', '--schema', './schema.graphql', '--json'], {
        cwd: combined,
      }),
    );

    // Absent, not empty: a consumer has to be able to tell "nothing found"
    // from "never looked".
    expect(keysOf(withoutFields)).toEqual([
      'deprecatedUsages',
      'orphanedFiles',
      'summary',
      'unusedFragments',
      'unusedOperations',
      'warnings',
    ]);
    expect(keysOf(withoutFields.summary)).not.toContain('unusedFields');
  });

  it('shapes each unused operation as name, type, file, line and grade', () => {
    expect(full.unusedOperations.length).toBeGreaterThan(0);
    for (const entry of full.unusedOperations) {
      expect(keysOf(entry)).toEqual([
        'confidence',
        'file',
        'line',
        'name',
        'reason',
        'type',
      ]);
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.file).toBe('string');
      expect(typeof entry.line).toBe('number');
      expect(['query', 'mutation', 'subscription']).toContain(entry.type);
      expect(['high', 'medium', 'low']).toContain(entry.confidence);
    }
  });

  it('shapes each unused fragment as name, file, line and grade', async () => {
    // combined/ has no dead fragment; app/ does, and it is the same shape.
    const report = parseReport(
      await runCli(['--graphql', 'app/graphql', '--src', 'app/src', '--json']),
    );

    expect(report.unusedFragments.length).toBeGreaterThan(0);
    for (const entry of report.unusedFragments) {
      expect(keysOf(entry)).toEqual([
        'confidence',
        'file',
        'line',
        'name',
        'reason',
      ]);
    }
  });

  it('shapes each orphaned file as an object, not a string', () => {
    expect(full.orphanedFiles.length).toBeGreaterThan(0);
    for (const entry of full.orphanedFiles) {
      // The 3.0.0 break. A consumer written against 2.x reads this as a path.
      expect(typeof entry).toBe('object');
      expect(keysOf(entry)).toEqual(['confidence', 'file', 'reason']);
      expect(typeof entry.file).toBe('string');
    }
  });

  it('shapes each deprecated selection as message, file and line, ungraded', () => {
    expect(full.deprecatedUsages.length).toBeGreaterThan(0);
    for (const entry of full.deprecatedUsages) {
      expect(keysOf(entry)).toEqual(['file', 'line', 'message']);
    }
  });

  it('shapes each field candidate as field, locations and grade', () => {
    expect(full.unusedFields?.length).toBeGreaterThan(0);
    for (const entry of full.unusedFields ?? []) {
      expect(keysOf(entry)).toEqual([
        'confidence',
        'field',
        'locations',
        'reason',
      ]);
      expect(entry.locations.length).toBeGreaterThan(0);
      for (const location of entry.locations) {
        expect(keysOf(location)).toEqual(['file', 'line']);
      }
    }
  });

  it('shapes the summary as one count per kind plus the grade tally', () => {
    expect(keysOf(full.summary)).toEqual([
      'byConfidence',
      'deprecatedUsages',
      'orphanedFiles',
      'unusedFields',
      'unusedFragments',
      'unusedOperations',
    ]);
    expect(keysOf(full.summary.byConfidence)).toEqual([
      'high',
      'low',
      'medium',
    ]);
    for (const count of Object.values(full.summary.byConfidence)) {
      expect(typeof count).toBe('number');
    }
  });

  it('always carries warnings as an array of strings', () => {
    expect(Array.isArray(full.warnings)).toBe(true);
    for (const warning of full.warnings) {
      expect(typeof warning).toBe('string');
    }
  });
});

describe('the exit-code matrix', () => {
  // 0 clean, 1 findings, 2 for every usage and configuration failure. Gathered
  // in one place so the whole documented matrix is visible at once, and so a
  // new failure path that quietly exits 1 stands out against its neighbours.

  it('exits 0 on a clean project', async () => {
    expect((await runCli(CLEAN_SCAN)).code).toBe(0);
  });

  it('exits 0 when only advisory sections have anything to say', async () => {
    // A deprecated selection and a field candidate never carry the exit code.
    const result = await runCli([
      ...CLEAN_SCAN,
      '--schema',
      'schema.graphql',
      '--fields',
    ]);

    expect(result.code).toBe(0);
  });

  it('exits 1 on findings', async () => {
    const result = await runCli([
      '--graphql',
      'app/graphql',
      '--src',
      'app/src',
    ]);

    expect(result.code).toBe(1);
  });

  const usageFailures: [string, string[], string][] = [
    ['an unknown flag', ['--nope'], 'Unknown flag: --nope'],
    ['an unknown command', ['bogus'], 'Unknown command: bogus'],
    ['a flag missing its value', ['--graphql'], 'Missing value for --graphql'],
    [
      'a value a flag does not accept',
      [...CLEAN_SCAN, '--min-confidence', 'certain'],
      'Invalid value for --min-confidence',
    ],
    [
      'an unsupported completion shell',
      ['completion', 'ksh'],
      'Unsupported shell: ksh',
    ],
    ['no configuration at all', [], 'No configuration found.'],
    [
      'a configured directory that is not on disk',
      ['--graphql', 'app/nowhere', '--src', 'app/src'],
      'These configured directories do not exist',
    ],
    [
      'a glob matching no directory',
      ['--graphql', 'packages/*/nope', '--src', 'app/src'],
      'match no directories',
    ],
    [
      'a schema it cannot parse',
      [...CLEAN_SCAN, '--schema', 'schema-invalid.graphql'],
      'Could not read or parse the GraphQL schema file',
    ],
    [
      'a codegen config it cannot read',
      [...CLEAN_SCAN, '--codegen', 'codegen/nowhere.yml'],
      'Could not read codegen/nowhere.yml.',
    ],
  ];

  it.each(usageFailures)('exits 2 on %s', async (_label, args, message) => {
    const result = await runCli(args);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.stdout).toBe('');
  });

  // The same rows under --json: a failed run prints nothing on stdout there
  // either, so a consumer never has to tell an error apart from a report.
  it.each(usageFailures)(
    'exits 2 on %s in --json mode, with an empty stdout',
    async (_label, args, message) => {
      const result = await runCli(['--json', ...args]);

      expect(result.code).toBe(2);
      expect(result.stderr).toContain(message);
      expect(result.stdout).toBe('');
    },
  );

  it.each([[[]], [['--json']]])(
    'exits 2 on an invalid minConfidence in the config file, with %j',
    async (args) => {
      const result = await runCli(args, { cwd: fixtureProject('bad-config') });

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('Invalid minConfidence');
      expect(result.stdout).toBe('');
    },
  );
});
