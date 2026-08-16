// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// End-to-end cases for confidence grading and the `--min-confidence` gate.
//
// Fixtures:
//   confidence/      eleven operations, three of them dead, one per grade: a
//                    name nothing mentions (high), a name only a suspected
//                    generated file mentions (medium), and a name ordinary
//                    source mentions outside any usage pattern (low)
//   confidence-low/  a single low-confidence finding and nothing above it, so
//                    a gate can empty the report and take the exit code with it
//   bad-config/      a gqlPrune.config.yaml carrying an invalid minConfidence

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

const GRADED_SCAN = [
  '--graphql',
  'confidence/graphql',
  '--src',
  'confidence/src',
];
const LOW_SCAN = [
  '--graphql',
  'confidence-low/graphql',
  '--src',
  'confidence-low/src',
];
const APP_SCAN = ['--graphql', 'app/graphql', '--src', 'app/src'];

beforeAll(() => {
  assertCliBuilt();
});

describe('a project producing all three grades at once', () => {
  let result: CliResult;

  beforeAll(async () => {
    result = await runCli([...GRADED_SCAN, '--json']);
  });

  it('grades each finding and records the evidence behind it', () => {
    const report = parseReport(result);
    const byName = Object.fromEntries(
      report.unusedOperations.map((op) => [op.name, op]),
    );

    expect(byName.GetConfidenceHigh).toMatchObject({
      confidence: 'high',
      reason: 'name-absent',
    });
    expect(byName.GetConfidenceMedium).toMatchObject({
      confidence: 'medium',
      reason: 'generated-only',
    });
    expect(byName.GetConfidenceLow).toMatchObject({
      confidence: 'low',
      reason: 'source-mention',
    });
  });

  it('counts them per level in the summary', () => {
    const report = parseReport(result);

    // Two lows: the operation, and the orphaned file that inherits its grade.
    expect(report.summary.byConfidence).toEqual({ high: 1, medium: 1, low: 2 });
  });

  it('shows every grade in the human report, with its reason under --verbose', async () => {
    const human = await runCli([...GRADED_SCAN, '--verbose']);

    expectInOrder(human.stdout, [
      '--- Unused GraphQL Operations ---',
      'Confidence',
      'GetConfidenceHigh',
      'GetConfidenceMedium',
      'GetConfidenceLow',
    ]);
    expect(human.stdout).toContain('high');
    expect(human.stdout).toContain('medium');
    expect(human.stdout).toContain('low');
    // The evidence is explained on stderr, so it never enters --json's stdout.
    expect(human.stderr).toContain(
      'confidence: operation "GetConfidenceHigh" is high (name-absent:',
    );
    expect(human.stderr).toContain(
      'confidence: operation "GetConfidenceMedium" is medium (generated-only:',
    );
    expect(human.stderr).toContain(
      'confidence: operation "GetConfidenceLow" is low (source-mention:',
    );
  });

  it('gives an orphaned file the weakest grade among its definitions', () => {
    const report = parseReport(result);

    // dead.gql holds all three, and one definition that still looks live
    // undermines the whole-file verdict whatever the others say.
    expect(report.orphanedFiles).toEqual([
      {
        file: expect.stringContaining('dead.gql'),
        confidence: 'low',
        reason: 'source-mention',
      },
    ]);
  });
});

describe('--min-confidence', () => {
  it('suppresses everything below the gate', async () => {
    const result = await runCli([
      ...GRADED_SCAN,
      '--min-confidence',
      'high',
      '--json',
    ]);
    const report = parseReport(result);

    expect(report.unusedOperations.map((op) => op.name)).toEqual([
      'GetConfidenceHigh',
    ]);
    // The orphaned file is graded low, so the gate takes it too.
    expect(report.orphanedFiles).toEqual([]);
    expect(report.summary.byConfidence).toEqual({ high: 1, medium: 0, low: 0 });
    // Something was still reported, so the run still fails.
    expect(result.code).toBe(1);
  });

  it('takes the exit code with it when only weaker findings existed', async () => {
    const ungated = await runCli([...LOW_SCAN, '--json']);
    const gated = await runCli([...LOW_SCAN, '--min-confidence', 'high']);

    // The gate decides what is reported, and reporting is what sets the exit
    // code: a CI job can fail on high-confidence findings alone.
    expect(ungated.code).toBe(1);
    expect(parseReport(ungated).orphanedFiles).toEqual([
      {
        file: expect.stringContaining('archived.gql'),
        confidence: 'low',
        reason: 'source-mention',
      },
    ]);
    expect(gated.code).toBe(0);
    expect(gated.stdout).toContain(
      'No unused GraphQL operations or fragments found.',
    );
  });

  it('exits 2 on a value the flag does not accept', async () => {
    const result = await runCli([
      ...GRADED_SCAN,
      '--min-confidence',
      'certain',
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      'Invalid value for --min-confidence: certain (expected high, medium, low)',
    );
    expect(result.stdout).toBe('');
  });

  it('exits 2 on a value the config file carries', async () => {
    // The flag rejects its own bad values before the scan starts; this is the
    // other way in, and it must stop the run rather than gate on nothing.
    const result = await runCli([], { cwd: fixtureProject('bad-config') });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      'Invalid minConfidence: bogus. Expected one of high, medium, low.',
    );
  });
});

describe('what is graded and what is not', () => {
  it('leaves deprecated selections ungraded', async () => {
    const result = await runCli([
      ...APP_SCAN,
      '--schema',
      'schema.graphql',
      '--json',
    ]);
    const report = parseReport(result);

    expectJsonOnlyStdout(result);
    expect(report.deprecatedUsages.length).toBeGreaterThan(0);
    for (const usage of report.deprecatedUsages) {
      // Validated against a real schema, so they are facts, not candidates.
      expect(usage).not.toHaveProperty('confidence');
      expect(usage).not.toHaveProperty('reason');
    }
  });

  it('never grades a field candidate above medium', async () => {
    const report = parseReport(
      await runCli([...APP_SCAN, '--fields', '--json']),
    );

    // The name appears nowhere at all, which is `high` evidence, but the check
    // cannot see a read through a rename, a spread or a computed key, so the
    // grade is capped and says why.
    expect(report.unusedFields).toEqual([
      {
        field: 'internalAuditTrail',
        locations: [
          {
            file: expect.stringContaining('user.gql'),
            line: expect.any(Number),
          },
        ],
        confidence: 'medium',
        reason: 'heuristic-cap',
      },
    ]);
  });

  it('keeps a suspected generated file out of the low grade', async () => {
    const report = parseReport(await runCli([...GRADED_SCAN, '--json']));

    // The same mention in ordinary source would have graded low. It is the
    // file it sits in that makes it medium, and the scan says so separately.
    expect(
      report.warnings.some((warning) =>
        warning.includes('Suspected generated file'),
      ),
    ).toBe(true);
    expect(
      report.unusedOperations.find((op) => op.name === 'GetConfidenceMedium')
        ?.confidence,
    ).toBe('medium');
  });
});

describe('annotations', () => {
  it('ends every candidate annotation with its grade', async () => {
    const result = await runCli([...GRADED_SCAN, '--annotate']);
    const annotations = result.stderr
      .split('\n')
      .filter((line) => line.startsWith('::warning file='));

    expect(
      annotations.some(
        (line) =>
          line.includes('GetConfidenceHigh') &&
          line.includes('[confidence: high]'),
      ),
    ).toBe(true);
    expect(
      annotations.some((line) =>
        toPosix(line).includes('confidence/graphql/dead.gql'),
      ),
    ).toBe(true);
    expect(result.stdout).not.toContain('::warning');
  });
});
