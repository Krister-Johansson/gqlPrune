// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  extractInlineDocuments,
  findInlineDocumentSites,
  findInlineIdentifierUsage,
  toInlineEntities,
} from '../src/utils/inline';

describe('findInlineDocumentSites', () => {
  it('finds a gql tagged template', () => {
    const content = 'const q = gql`query GetUser { user { id } }`;\n';

    const sites = findInlineDocumentSites(content);

    expect(sites).toHaveLength(1);
    expect(sites[0].body).toBe('query GetUser { user { id } }');
    expect(sites[0].identifier).toBe('q');
  });

  it('finds a graphql tagged template', () => {
    const sites = findInlineDocumentSites('graphql`query A { a }`');

    expect(sites.map((site) => site.body)).toEqual(['query A { a }']);
  });

  it('finds a tag reached through a member expression', () => {
    const sites = findInlineDocumentSites('apollo.gql`query A { a }`');

    expect(sites.map((site) => site.body)).toEqual(['query A { a }']);
  });

  it('finds a helper call with a single-quoted argument', () => {
    const sites = findInlineDocumentSites(
      "const q = graphql('query A { a }');",
    );

    expect(sites.map((site) => site.body)).toEqual(['query A { a }']);
    expect(sites[0].identifier).toBe('q');
  });

  it('finds a helper call with a double-quoted argument', () => {
    const sites = findInlineDocumentSites(
      'const q = graphql("query A { a }");',
    );

    expect(sites.map((site) => site.body)).toEqual(['query A { a }']);
  });

  it('finds a helper call with a backtick argument', () => {
    const sites = findInlineDocumentSites('const q = gql(`query A { a }`);');

    expect(sites.map((site) => site.body)).toEqual(['query A { a }']);
  });

  it('captures the identifier of an exported constant', () => {
    const sites = findInlineDocumentSites(
      'export const GetUserDocument = graphql(`query GetUser { id }`);',
    );

    expect(sites[0].identifier).toBe('GetUserDocument');
  });

  it('captures the identifier through a type annotation', () => {
    const sites = findInlineDocumentSites(
      'const q: TypedDocumentNode<A, B> = gql`query A { a }`;',
    );

    expect(sites[0].identifier).toBe('q');
  });

  it('leaves the identifier absent when the document is passed inline', () => {
    const sites = findInlineDocumentSites('useQuery(gql`query A { a }`);');

    expect(sites).toHaveLength(1);
    expect(sites[0].identifier).toBeUndefined();
  });

  it('reports the line and column the body starts on', () => {
    const content = [
      '// header',
      '',
      'const q = gql`',
      '  query A { a }',
      '`;',
    ].join('\n');

    const sites = findInlineDocumentSites(content);

    expect(sites[0].line).toBe(3);
    expect(sites[0].column).toBe('const q = gql`'.length + 1);
  });

  it('blanks interpolations without changing the body length', () => {
    const content = 'const q = gql`query A { ...F }\n${FDoc}\n`;';

    const sites = findInlineDocumentSites(content);

    expect(sites[0].body).toBe('query A { ...F }\n       \n');
    expect(sites[0].body).toHaveLength('query A { ...F }\n${FDoc}\n'.length);
  });

  it('ignores a graphql import specifier', () => {
    expect(findInlineDocumentSites("import { parse } from 'graphql';")).toEqual(
      [],
    );
    expect(findInlineDocumentSites("const x = require('graphql');")).toEqual(
      [],
    );
  });

  it('ignores a tag whose name only ends with gql', () => {
    expect(findInlineDocumentSites('mygql`query A { a }`')).toEqual([]);
  });

  it('does not end a literal at an escaped quote', () => {
    const content = String.raw`const q = graphql('query A { a(t: \'x\') }');`;

    const sites = findInlineDocumentSites(content);

    expect(sites.map((site) => site.body)).toEqual([
      String.raw`query A { a(t: \'x\') }`,
    ]);
  });

  it('ignores an interpolation that never closes', () => {
    expect(findInlineDocumentSites('const q = gql`query A { ${x`;')).toEqual(
      [],
    );
  });

  it('ignores an unterminated template', () => {
    expect(findInlineDocumentSites('const q = gql`query A {')).toEqual([]);
  });

  it('ignores a quoted argument that never closes on its line', () => {
    expect(findInlineDocumentSites("const q = graphql('query A {\n')")).toEqual(
      [],
    );
  });

  it('returns nothing for a file without GraphQL', () => {
    expect(
      findInlineDocumentSites('export const total = items.length;\n'),
    ).toEqual([]);
  });

  it('finds several documents in one file', () => {
    const content = [
      'const a = gql`query A { a }`;',
      'const b = graphql("query B { b }");',
    ].join('\n');

    expect(
      findInlineDocumentSites(content).map((site) => site.identifier),
    ).toEqual(['a', 'b']);
  });
});

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

    const extraction = extractInlineDocuments('src/App.tsx', content);

    expect(extraction.file).toBe('src/App.tsx');
    expect(extraction.skipped).toBe(0);
    expect(extraction.documents).toHaveLength(1);
    const [document] = extraction.documents;
    expect(document.identifier).toBe('GetUserDocument');
    expect(document.document.definitions[0].loc?.startToken.line).toBe(4);
    expect(document.document.loc?.source.name).toBe('src/App.tsx');
  });

  it('skips a body that fails to parse and counts it', () => {
    const extraction = extractInlineDocuments(
      'src/App.tsx',
      'const broken = gql`query {{{`;\nconst ok = gql`query A { a }`;',
    );

    expect(extraction.skipped).toBe(1);
    expect(extraction.documents).toHaveLength(1);
    expect(extraction.documents[0].identifier).toBe('ok');
  });

  it('blanks the whole defining statement out of the corpus text', () => {
    const content =
      'const GetUserDocument = graphql(`query GetUser { id }`);\n';

    const { blankedContent } = extractInlineDocuments('src/App.tsx', content);

    expect(blankedContent).not.toContain('GetUserDocument');
    expect(blankedContent).not.toContain('GetUser ');
    expect(blankedContent).toHaveLength(content.length);
  });

  it('keeps the surrounding code and the interpolated names visible', () => {
    const content = [
      'import { useQuery } from "urql";',
      'const q = gql`',
      '  query A { ...F }',
      '  ${FFragmentDoc}',
      '`;',
      'useQuery({ query: q });',
    ].join('\n');

    const { blankedContent } = extractInlineDocuments('src/App.tsx', content);

    expect(blankedContent).toContain('import { useQuery } from "urql";');
    expect(blankedContent).toContain('FFragmentDoc');
    expect(blankedContent).toContain('useQuery({ query: q });');
    expect(blankedContent).not.toContain('query A');
    expect(blankedContent).toHaveLength(content.length);
  });

  it('finds nothing in a file without GraphQL', () => {
    const content = 'export const total = items.length;\n';

    const extraction = extractInlineDocuments('src/total.ts', content);

    expect(extraction.documents).toEqual([]);
    expect(extraction.skipped).toBe(0);
    expect(extraction.blankedContent).toBe(content);
  });
});

describe('toInlineEntities', () => {
  const entitiesFor = (content: string, file = 'src/App.tsx') =>
    toInlineEntities(extractInlineDocuments(file, content).documents);

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
  const entitiesFor = (content: string, file = 'src/App.tsx') =>
    toInlineEntities(extractInlineDocuments(file, content).documents);

  it('reports a document whose constant is referenced elsewhere', () => {
    const entities = entitiesFor('const q = gql`query GetUser { id }`;');

    const usage = findInlineIdentifierUsage(entities, [
      { file: 'src/Page.tsx', content: 'useQuery(q);' },
    ]);

    expect(usage).toEqual([
      {
        identifier: 'q',
        file: 'src/Page.tsx',
        operations: ['GetUser'],
        fragments: [],
      },
    ]);
  });

  it('reports nothing when the constant is referenced nowhere', () => {
    const entities = entitiesFor('const q = gql`query GetUser { id }`;');

    expect(
      findInlineIdentifierUsage(entities, [
        { file: 'src/Page.tsx', content: 'const other = 1;' },
      ]),
    ).toEqual([]);
  });

  it('requires a whole-word match, not a substring', () => {
    const entities = entitiesFor('const q = gql`query GetUser { id }`;');

    expect(
      findInlineIdentifierUsage(entities, [
        { file: 'src/Page.tsx', content: 'runQuery(request);' },
      ]),
    ).toEqual([]);
  });

  it('lists the fragments the document defines', () => {
    const entities = entitiesFor(
      'const f = gql`fragment UserFields on User { id }`;',
    );

    const usage = findInlineIdentifierUsage(entities, [
      { file: 'src/Page.tsx', content: 'useFragment(f, user);' },
    ]);

    expect(usage[0].fragments).toEqual(['UserFields']);
    expect(usage[0].operations).toEqual([]);
  });

  it('ignores documents that are not assigned to a constant', () => {
    const entities = entitiesFor('useQuery(gql`query GetUser { id }`);');

    expect(
      findInlineIdentifierUsage(entities, [
        { file: 'src/Page.tsx', content: 'GetUser' },
      ]),
    ).toEqual([]);
  });
});
