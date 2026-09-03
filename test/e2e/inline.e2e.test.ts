// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// End-to-end cases for the opt-in inline-document scan (`--inline`).
//
// Two of them guard the worst failure this tool can have: silently declaring a
// dead query alive. An inline document sits in the very file the usage search
// reads, so both its GraphQL text and the constant it is assigned to would
// count as references to itself unless the scan blanks the defining statement
// out of the corpus first. Those two cases are named after the invariant they
// protect, so a regression says what broke.
//
// Fixtures:
//   inline/            one used .gql operation, three dead inline documents,
//                      one inline document kept alive through its constant, and
//                      tags written inside a line comment, a block comment and
//                      a string
//   inline-fragments/  a fragment defined inline and spread from a .gql file,
//                      and a fragment defined in a .gql file and spread from an
//                      inline document

import {
  assertCliBuilt,
  fixtureProject,
  lineOf,
  parseReport,
  runCli,
  toPosix,
  type CliResult,
} from './helpers';

const INLINE_SCAN = ['--graphql', 'inline/graphql', '--src', 'inline/src'];
const FRAGMENT_SCAN = [
  '--graphql',
  'inline-fragments/graphql',
  '--src',
  'inline-fragments/src',
];

const documentsFixture = fixtureProject('inline', 'src', 'documents.ts');

beforeAll(() => {
  assertCliBuilt();
});

describe('inline documents', () => {
  let result: CliResult;

  beforeAll(async () => {
    result = await runCli([...INLINE_SCAN, '--inline', '--json']);
  });

  it('is off unless asked for: the same project reports nothing', async () => {
    const off = await runCli(INLINE_SCAN);

    expect(off.code).toBe(0);
    expect(off.stdout).toContain(
      'No unused GraphQL operations or fragments found.',
    );
    // The count line only appears once the pass has run, so its absence is the
    // second half of "the scan never looked at the source files for documents".
    expect(off.stdout).not.toContain('inline GraphQL documents');
  });

  it('counts the documents it parsed out of the source files', async () => {
    const human = await runCli([...INLINE_SCAN, '--inline']);

    expect(human.stdout).toContain('Found 4 inline GraphQL documents.');
  });

  it('reports a dead gql`...` document at its real line in the source file', () => {
    const report = parseReport(result);
    const finding = report.unusedOperations.find(
      (op) => op.name === 'GetInlineAbandoned',
    );

    expect(finding).toBeDefined();
    expect(toPosix(finding!.file)).toBe('inline/src/documents.ts');
    // Located against the .ts file itself, not against the template's own
    // first line: a document found at line 1 means the padding was lost.
    expect(finding!.line).toBe(
      lineOf(documentsFixture, 'query GetInlineAbandoned {'),
    );
    expect(finding!.line).toBeGreaterThan(1);
  });

  it("INVARIANT: a document's own text never counts as its own usage", () => {
    const report = parseReport(result);

    // The body of this document contains the exact identifier the built-in
    // use{Name}{Type} pattern searches for. If it is ever reported used, the
    // defining statement is being left in the corpus and every dead inline
    // query is being declared alive.
    expect(report.unusedOperations.map((op) => op.name)).toContain(
      'GetSelfReferenced',
    );
  });

  it('INVARIANT: a {Name}Document constant is a definition, not a reference', () => {
    const report = parseReport(result);

    // `const GetInlineDocumentedDocument = graphql('query GetInlineDocumented ...')`
    // matches the built-in {Name}Document pattern character for character, and
    // nothing references it. It is the definition site, so the operation is
    // still dead.
    expect(report.unusedOperations.map((op) => op.name)).toContain(
      'GetInlineDocumented',
    );
  });

  it('keeps a document alive through the constant it is assigned to', () => {
    const report = parseReport(result);

    // The client-preset path: `const q = graphql(...)` then `useQuery(q)` names
    // the operation nowhere, so only following the identifier can save it.
    expect(report.unusedOperations.map((op) => op.name)).not.toContain(
      'GetInlineDashboard',
    );
  });

  it('reads no document out of a comment or a string', () => {
    const report = parseReport(result);
    const names = report.unusedOperations.map((op) => op.name);

    expect(names).not.toContain('GetCommentedOut');
    expect(names).not.toContain('GetBlockCommented');
    expect(names).not.toContain('GetQuotedAway');
    // And the scanner recovers: every real document in that file sits after
    // the three decoys and is still found.
    expect(names).toEqual(
      expect.arrayContaining([
        'GetInlineAbandoned',
        'GetSelfReferenced',
        'GetInlineDocumented',
      ]),
    );
  });

  it('never calls a source file orphaned, however dead its documents are', () => {
    const report = parseReport(result);

    // documents.ts holds three dead documents and nothing else. "Delete the
    // whole file" is only ever advice about a .gql/.graphql document.
    expect(report.orphanedFiles).toEqual([]);
  });

  it('grades an inline finding against the blanked corpus', () => {
    const report = parseReport(result);

    // Grading searches the bare name, and the only place these names appear is
    // inside their own documents. Blanked, that leaves no mention at all, so
    // the evidence is `name-absent`. A `low` grade here would mean the grader
    // read a document as corroboration of itself.
    for (const name of [
      'GetInlineAbandoned',
      'GetSelfReferenced',
      'GetInlineDocumented',
    ]) {
      const finding = report.unusedOperations.find((op) => op.name === name);
      expect(finding).toMatchObject({
        confidence: 'high',
        reason: 'name-absent',
      });
    }
  });
});

describe('inline documents and .gql files together', () => {
  it('resolves spreads in both directions and finds nothing unused', async () => {
    const result = await runCli([...FRAGMENT_SCAN, '--inline', '--json']);
    const report = parseReport(result);

    // InlineBadgeFields is defined inline and spread from graphql/report.gql;
    // GqlReportMetaFields is defined in graphql/fragments.gql and spread from
    // an inline document. Both directions have to resolve for this to be empty.
    expect(report.unusedFragments).toEqual([]);
    expect(report.unusedOperations).toEqual([]);
    expect(result.code).toBe(0);
  });

  it('loses the .gql fragment when the inline pass is off', async () => {
    const result = await runCli([...FRAGMENT_SCAN, '--json']);
    const report = parseReport(result);

    // The contrast that proves the spread above did the work: with no inline
    // documents in the corpus, the only thing spreading this fragment is gone.
    expect(report.unusedFragments.map((fragment) => fragment.name)).toEqual([
      'GqlReportMetaFields',
    ]);
    expect(report.orphanedFiles.map((orphan) => toPosix(orphan.file))).toEqual([
      'inline-fragments/graphql/fragments.gql',
    ]);
    expect(result.code).toBe(1);
  });
});
