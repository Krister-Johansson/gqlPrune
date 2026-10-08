// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// End-to-end cases for the field check: operations traced from their call
// sites grade high, operations with nothing to trace fall back to a name
// search and grade medium, and a value handed to code the trace cannot follow
// counts as read.
//
// Fixture:
//   field-tracing/  graphql holds five used operations, one per verdict shape
//                   (traced through destructuring and one component hop,
//                   traced through a document constant and list callbacks,
//                   escaped into a helper, a client.query fallback and a
//                   mutation fallback); src holds their only call sites

import {
  assertCliBuilt,
  expectJsonOnlyStdout,
  parseReport,
  runCli,
  toPosix,
  type CliResult,
} from './helpers';

const SCAN = [
  '--graphql',
  'field-tracing/graphql',
  '--src',
  'field-tracing/src',
];

let json: CliResult;

beforeAll(async () => {
  assertCliBuilt();
  json = await runCli([...SCAN, '--fields', '--json']);
});

/** Every candidate as `operation path confidence/reason`, in report order. */
function findings(result: CliResult): string[] {
  return (parseReport(result).unusedFields ?? []).map(
    (candidate) =>
      `${candidate.operation} ${candidate.path} ${candidate.confidence}/${candidate.reason}`,
  );
}

describe('field tracing', () => {
  it('keeps stdout to the JSON document, and the candidates off the exit code', () => {
    expectJsonOnlyStdout(json);
    expect(parseReport(json).unusedOperations).toEqual([]);
    expect(json.code).toBe(0);
  });

  it('grades what no traced read reaches high, per operation and path', () => {
    const traced = findings(json).filter((line) => line.includes('high/'));

    // GetTracedUser: the name and city through destructuring, the id through
    // a key attribute, the bio one hop into ProfileCard. The fragment's other
    // field is judged as part of the operation.
    // GetTracedFeed: title through a filter callback, id and author.name
    // through the map callback that follows it.
    expect(traced).toEqual([
      'GetTracedFeed feed.body high/never-read',
      'GetTracedFeed feed.author.id high/never-read',
      'GetTracedUser user.avatarUrl high/never-read',
      'GetTracedUser user.address.zip high/never-read',
      'GetTracedUser user.website high/never-read',
    ]);
  });

  it('falls back to the name search, graded medium, where it cannot trace', () => {
    const fallback = findings(json).filter((line) => line.includes('medium/'));

    // client.query takes the document inside an object; a mutation may only
    // feed the cache. Both match each of their own keys by name.
    expect(fallback.sort()).toEqual([
      'GetFallbackStats stats.secretRatio medium/heuristic-cap',
      'SaveTracedUser saveUser medium/heuristic-cap',
      'SaveTracedUser saveUser.staleField medium/heuristic-cap',
    ]);
  });

  it('reports nothing under a value handed to code it cannot follow', () => {
    expect(
      findings(json).some((line) => line.startsWith('GetEscapedSettings')),
    ).toBe(false);
  });

  it('never reports __typename', () => {
    expect(findings(json).some((line) => line.includes('__typename'))).toBe(
      false,
    );
  });

  it('locates a fragment field in the fragment file', () => {
    const website = parseReport(json).unusedFields?.find(
      (candidate) => candidate.path === 'user.website',
    );

    expect(website?.field).toBe('website');
    expect(toPosix(website?.locations[0].file ?? '')).toContain(
      'field-tracing/graphql/fragments.gql',
    );
  });

  it('keeps only the traced candidates at --min-confidence high', async () => {
    const result = await runCli([
      ...SCAN,
      '--fields',
      '--json',
      '--min-confidence',
      'high',
    ]);

    expect(
      findings(result).every((line) => line.includes('high/never-read')),
    ).toBe(true);
    expect(findings(result)).toHaveLength(5);
    expect(result.code).toBe(0);
  });

  it('leaves the key out without --fields', async () => {
    expect(parseReport(await runCli([...SCAN, '--json']))).not.toHaveProperty(
      'unusedFields',
    );
  });
});

describe('field tracing, as a human and a CI run read it', () => {
  it('prints the operation and the path in the table', async () => {
    const result = await runCli([...SCAN, '--fields']);

    expect(result.stdout).toContain('--- Unused Field Candidates ---');
    expect(result.stdout).toMatch(
      /Operation\s+Path\s+Confidence\s+Selected in/,
    );
    expect(result.stdout).toMatch(/GetTracedUser\s+user\.address\.zip\s+high/);
    expect(result.stdout).toContain(
      'Found 8 field candidates that nothing in the source appears to read.',
    );
  });

  it('says per operation whether it was traced or matched by name', async () => {
    const result = await runCli([...SCAN, '--fields', '--verbose']);
    const stderr = toPosix(result.stderr);

    expect(stderr).toContain(
      'fields: GetTracedUser (query) traced through 1 call site: ' +
        'field-tracing/src/UserPage.tsx:7:29',
    );
    expect(stderr).toContain(
      'fields: GetFallbackStats (query) matched by name: the reference at ' +
        'field-tracing/src/Stats.ts:7:46 is not a call it can trace',
    );
    expect(stderr).toContain(
      'fields: SaveTracedUser (mutation) matched by name:',
    );
  });

  it('names the path and the operation in each annotation', async () => {
    const result = await runCli([...SCAN, '--fields', '--annotate']);

    expect(result.stderr).toContain(
      'Unused GraphQL field candidate "user.website" in operation ' +
        '"GetTracedUser" (no traced read reaches it) [confidence: high]',
    );
    expect(result.stderr).toContain(
      'Unused GraphQL field candidate "stats.secretRatio" in operation ' +
        '"GetFallbackStats" (name not found in source) [confidence: medium]',
    );
  });
});
