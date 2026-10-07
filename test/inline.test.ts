// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  extractInlineDocuments,
  findInlineIdentifierUsage,
  toInlineEntities,
} from '../src/utils/inline';
import { parseSourceModule } from '../src/utils/sourceModule';
import { indexOf } from './support';

// Document sites come from the parsed syntax tree now (see
// test/sourceModule.test.ts for the recognition cases); these tests cover
// what the inline pass makes of them.

const extract = (content: string, file = 'src/App.tsx') =>
  extractInlineDocuments(parseSourceModule(file, content));

describe('extractInlineDocuments', () => {
  it('parses the body and locates definitions at their real line', () => {
    const content = [
      'import { gql } from "@apollo/client";',
      '',
      'export const GetUserDocument = gql`',
      '  query GetUser {',
      '    user { id }',
      '  }',
      '`;',
    ].join('\n');

    const extraction = extract(content);

    expect(extraction.file).toBe('src/App.tsx');
    expect(extraction.skipped).toBe(0);
    expect(extraction.documents).toHaveLength(1);
    const [document] = extraction.documents;
    expect(document.identifier).toBe('GetUserDocument');
    expect(document.document.definitions[0].loc?.startToken.line).toBe(4);
    expect(document.document.loc?.source.name).toBe('src/App.tsx');
  });

  it('skips a body that fails to parse and counts it', () => {
    const extraction = extract(
      'const broken = gql`query {{{`;\nconst ok = gql`query A { a }`;',
    );

    expect(extraction.skipped).toBe(1);
    expect(extraction.documents).toHaveLength(1);
    expect(extraction.documents[0].identifier).toBe('ok');
  });

  it('records the body offsets of what parsed, for the passes that still read text', () => {
    const content =
      "const q = graphql('query A { a }', { fetchPolicy: 'no-cache' });\nconst broken = gql`query {{{`;";

    const extraction = extract(content);

    expect(extraction.bodyRanges).toHaveLength(1);
    const [{ start, end }] = extraction.bodyRanges;
    expect(content.slice(start, end)).toBe('query A { a }');
  });

  it('carries whether the document is consumed where it stands', () => {
    expect(extract('useQuery(gql`query A { a }`);').documents[0].consumed).toBe(
      true,
    );
    expect(extract('gql`query A { a }`;').documents[0].consumed).toBe(false);
  });

  it('finds nothing in a file without GraphQL', () => {
    const extraction = extract('export const total = items.length;\n');

    expect(extraction.documents).toEqual([]);
    expect(extraction.skipped).toBe(0);
    expect(extraction.bodyRanges).toEqual([]);
  });

  it('captures the constant through a multi-line type annotation', () => {
    // What Prettier and codegen produce once the annotation passes the print
    // width. Losing the identifier here loses the only usage signal the client
    // preset has.
    const content = [
      'export const GetUserDoc: TypedDocumentNode<',
      '  GetUserQuery,',
      '  GetUserQueryVariables',
      '> = graphql(`query GetUser { user { id } }`);',
    ].join('\n');

    expect(extract(content).documents[0].identifier).toBe('GetUserDoc');
  });

  it('does not lend a preceding declaration to the document that follows', () => {
    const content = [
      'let cache: Map<string, unknown>',
      'const useQueryDoc = graphql(`query GetUser { id }`);',
      'declare let __DEV__: boolean',
      'export const Doc = graphql(`query GetUser2 { id }`);',
      'const Union: TypedDocumentNode<A, B> | undefined = graphql(`query G { id }`);',
    ].join('\n');

    expect(extract(content).documents.map((d) => d.identifier)).toEqual([
      'useQueryDoc',
      'Doc',
      'Union',
    ]);
  });
});

describe('toInlineEntities', () => {
  const entitiesFor = (content: string, file = 'src/App.tsx') =>
    toInlineEntities(extract(content, file).documents);

  it('carries the operations with the source file path and real line', () => {
    const entities = entitiesFor('\nconst q = gql`query GetUser { id }`;');

    expect(entities).toHaveLength(1);
    expect(entities[0].filePath).toBe('src/App.tsx');
    expect(entities[0].identifier).toBe('q');
    expect(entities[0].imports).toEqual([]);
    expect(entities[0].operations).toEqual([
      { name: 'GetUser', type: 'query', filePath: 'src/App.tsx', line: 2 },
    ]);
  });

  it('carries fragments and the spreads between them', () => {
    const entities = entitiesFor(
      'const q = gql`query A { ...UserFields }`;\n' +
        'const f = gql`fragment UserFields on User { id }`;',
    );

    expect(entities[0].operationSpreads).toEqual(['UserFields']);
    expect(entities[1].fragments.map((fragment) => fragment.name)).toEqual([
      'UserFields',
    ]);
    expect(entities[1].fragmentSpreads).toEqual([
      { name: 'UserFields', spreads: [] },
    ]);
  });

  it('flags an anonymous operation instead of naming it', () => {
    const entities = entitiesFor('const q = gql`{ user { id } }`;');

    expect(entities[0].operations).toEqual([]);
    expect(entities[0].hasAnonymousOperation).toBe(true);
  });
});

describe('findInlineIdentifierUsage', () => {
  // Usage is a reference that resolves to the defining constant, found on
  // the reference index rather than by searching text for the name.
  const scan = (files: Record<string, string>) => {
    const entities = Object.entries(files).flatMap(([file, content]) =>
      toInlineEntities(extract(content, file).documents),
    );
    return findInlineIdentifierUsage(
      entities,
      indexOf(files, { inline: true }),
    );
  };

  it('reports a document whose constant is referenced in another file', () => {
    const usage = scan({
      'src/documents.ts': 'export const q = gql`query GetUser { id }`;',
      'src/Page.tsx': "import { q } from './documents';\nuseQuery(q);",
    });

    expect(usage).toEqual([
      {
        identifier: 'q',
        file: 'src/Page.tsx',
        line: 2,
        column: 10,
        operations: ['GetUser'],
        fragments: [],
      },
    ]);
  });

  it('reports a document whose constant is referenced in its own file', () => {
    const usage = scan({
      'src/App.tsx': 'const q = gql`query GetUser { id }`;\nuseQuery(q);',
    });

    expect(usage.map((entry) => entry.operations)).toEqual([['GetUser']]);
  });

  it('reports nothing when the constant is referenced nowhere', () => {
    expect(
      scan({
        'src/App.tsx': 'const q = gql`query GetUser { id }`;',
        'src/Page.tsx': 'const other = 1;',
      }),
    ).toEqual([]);
  });

  it('does not take the declaration as a reference', () => {
    expect(
      scan({
        'src/App.tsx':
          'export const GetUserDocument = gql`query GetUser { id }`;',
      }),
    ).toEqual([]);
  });

  it('does not match a longer identifier or a string holding the name', () => {
    expect(
      scan({
        'src/App.tsx': 'const q = gql`query GetUser { id }`;',
        'src/Page.tsx': "runQuery(request); const s = 'q';",
      }),
    ).toEqual([]);
  });

  it('lists the fragments the document defines', () => {
    const usage = scan({
      'src/App.tsx':
        'const f = gql`fragment UserFields on User { id }`;\nuseFragment(f, user);',
    });

    expect(usage[0].fragments).toEqual(['UserFields']);
    expect(usage[0].operations).toEqual([]);
  });

  it('keeps a document that is consumed where it is written', () => {
    // The plain Apollo idiom: the document is an argument, so the code that
    // defines it is the code that uses it. It has no name anything else could
    // refer to.
    const usage = scan({
      'src/App.tsx': 'useQuery(gql`query GetUser { id }`);',
    });

    expect(usage).toEqual([
      {
        identifier: 'its definition site',
        file: 'src/App.tsx',
        operations: ['GetUser'],
        fragments: [],
      },
    ]);
  });

  it('still reports a document standing alone as a statement', () => {
    expect(scan({ 'src/App.tsx': 'graphql(`query GetUser { id }`);' })).toEqual(
      [],
    );
    expect(
      scan({ 'src/App.tsx': 'const n = 1\ngraphql(`query GetUser { id }`)' }),
    ).toEqual([]);
  });

  it('keeps a document on the line after an expression that continues', () => {
    expect(
      scan({ 'src/App.tsx': 'useQuery(\n  gql`query GetUser { id }`,\n);' }),
    ).toHaveLength(1);
  });

  it("does not let another file's same-named constant vouch for a document", () => {
    // Both files call their document `query`, which is what the client preset
    // encourages. b.tsx uses its own; that must not keep a.tsx's dead document
    // alive. Binding identity, not a name match, is what keeps them apart.
    const usage = scan({
      'src/a.tsx': 'const query = graphql(`query DeadOne { a }`);',
      'src/b.tsx':
        'const query = graphql(`query LiveOne { b }`);\nuseQuery(query);',
    });

    expect(usage.flatMap((entry) => entry.operations)).toEqual(['LiveOne']);
  });

  it('follows a renamed import back to the defining constant', () => {
    const usage = scan({
      'src/documents.ts':
        'export const query = graphql(`query GetUser { id }`);',
      'src/Page.tsx':
        "import { query as userQuery } from './documents';\nuseQuery(userQuery);",
    });

    expect(usage.map((entry) => [entry.identifier, entry.file])).toEqual([
      ['query', 'src/Page.tsx'],
    ]);
  });
});
