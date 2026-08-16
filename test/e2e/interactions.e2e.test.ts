// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// Cross-feature end-to-end cases: every option the 3.0.0 release adds, turned
// on at once against one project. The three features were built separately, so
// the combinations are where a subtle bug would sit unnoticed.
//
// The other feature pairings are asserted next to the feature they belong to,
// because that is where a failure reads clearly:
//   inline + grading         inline.e2e.test.ts, "grades an inline finding
//                            against the blanked corpus"
//   codegen + inline         codegen.e2e.test.ts, "the client preset, end to end"
//   min-confidence + orphans confidence.e2e.test.ts, "--min-confidence"
//
// The fixture is combined/: a codegen.ts that configures the whole project, an
// SDL with a deprecated field, .gql documents and inline ones side by side, a
// field nothing reads, and findings at every grade.

import {
  assertCliBuilt,
  expectInOrder,
  expectJsonOnlyStdout,
  fixtureProject,
  parseReport,
  runCli,
  toPosix,
  type CliResult,
} from './helpers';

const combined = fixtureProject('combined');
const EVERYTHING = [
  '--inline',
  '--fields',
  '--schema',
  './schema.graphql',
  '--json',
];

beforeAll(() => {
  assertCliBuilt();
});

describe('every option at once', () => {
  let result: CliResult;

  beforeAll(async () => {
    // No --graphql or --src: the directories come from codegen.ts, so this run
    // exercises the derivation as well as everything asked for by flag.
    result = await runCli(EVERYTHING, { cwd: combined });
  });

  it('keeps stdout to the JSON document alone', () => {
    expectJsonOnlyStdout(result);
    expect(result.code).toBe(1);
  });

  it('reports the .gql and the inline findings side by side', () => {
    const report = parseReport(result);
    const files = report.unusedOperations.map((op) => toPosix(op.file));

    expect(report.unusedOperations.map((op) => op.name)).toEqual([
      'GetCombinedGhost',
      'GetCombinedLegacyExport',
      'GetCombinedInlineGhost',
    ]);
    expect(files).toContain('graphql/ghost.gql');
    expect(files).toContain('src/Dashboard.tsx');
  });

  it('names only .gql files as orphans, graded from their definitions', () => {
    const report = parseReport(result);

    expect(report.orphanedFiles.map((orphan) => toPosix(orphan.file))).toEqual([
      'graphql/ghost.gql',
      'graphql/legacy.gql',
    ]);
    expect(report.orphanedFiles.map((orphan) => orphan.confidence)).toEqual([
      'high',
      'low',
    ]);
  });

  it('checks the schema and the field candidates over both corpora', () => {
    const report = parseReport(result);

    expect(report.deprecatedUsages).toEqual([
      {
        message:
          'The field User.legacyEmail is deprecated. Use contact.email instead.',
        file: expect.stringContaining('user.gql'),
        line: expect.any(Number),
      },
    ]);
    // internalNotes is selected by a .gql document and read nowhere.
    // refreshedAt is selected by an inline document and read right beside it,
    // which is the only thing that keeps it off this list: a document's own
    // text is blanked out of the corpus before the keys are searched for.
    expect(report.unusedFields?.map((candidate) => candidate.field)).toEqual([
      'internalNotes',
    ]);
  });

  it('counts every graded finding once, across all four kinds', () => {
    const report = parseReport(result);

    // 2 high operations + 1 high orphan, 1 medium field candidate, 1 low
    // operation + 1 low orphan. The deprecated selection is ungraded and is
    // counted nowhere here.
    expect(report.summary).toMatchObject({
      unusedOperations: 3,
      unusedFragments: 0,
      orphanedFiles: 2,
      deprecatedUsages: 1,
      unusedFields: 1,
      byConfidence: { high: 3, medium: 1, low: 2 },
    });
  });
});

describe('every option at once, gated at medium', () => {
  let result: CliResult;

  beforeAll(async () => {
    result = await runCli([...EVERYTHING, '--min-confidence', 'medium'], {
      cwd: combined,
    });
  });

  it('drops the low findings and keeps the report coherent', () => {
    const report = parseReport(result);

    expect(report.unusedOperations.map((op) => op.name)).toEqual([
      'GetCombinedGhost',
      'GetCombinedInlineGhost',
    ]);
    expect(report.orphanedFiles.map((orphan) => toPosix(orphan.file))).toEqual([
      'graphql/ghost.gql',
    ]);
    // Counts follow what was reported, so nothing hidden is still counted.
    expect(report.summary).toMatchObject({
      unusedOperations: 2,
      orphanedFiles: 1,
      byConfidence: { high: 3, medium: 1, low: 0 },
    });
    expect(result.code).toBe(1);
  });

  it('leaves the advisory sections alone', () => {
    const report = parseReport(result);

    // The gate grades candidates. A deprecated selection is not one, so it is
    // never filtered out from under a reviewer.
    expect(report.deprecatedUsages).toHaveLength(1);
    expect(report.unusedFields).toHaveLength(1);
  });
});

describe('every option at once, as a human reads it', () => {
  it('prints the derivation, the counts and every section in order', async () => {
    const result = await runCli(
      ['--inline', '--fields', '--schema', './schema.graphql'],
      { cwd: combined },
    );

    expectInOrder(result.stdout, [
      'Using settings derived from codegen.ts:',
      'Found 3 GraphQL files.',
      'Found 5 GraphQL operations.',
      'Found 2 inline GraphQL documents.',
      '--- Unused GraphQL Operations ---',
      '--- Orphaned GraphQL Files ---',
      '--- Deprecated Field Usage ---',
      '--- Unused Field Candidates ---',
      'These are candidates from a string search.',
    ]);
    expect(result.code).toBe(1);
  });
});
