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

  it('ignores a tag inside a line comment', () => {
    expect(
      findInlineDocumentSites('// const q = gql`query A { a }`;\n'),
    ).toEqual([]);
  });

  it('ignores a tag inside a block comment', () => {
    expect(
      findInlineDocumentSites('/* const q = gql`query A { a }`; */\n'),
    ).toEqual([]);
  });

  it('ignores a tag inside a double-quoted string', () => {
    expect(
      findInlineDocumentSites('const note = "gql`query A { a }`";\n'),
    ).toEqual([]);
  });

  it('ignores a tag inside a single-quoted string', () => {
    expect(
      findInlineDocumentSites("const note = 'gql`query A { a }`';\n"),
    ).toEqual([]);
  });

  it('ignores a tag inside an ordinary template literal', () => {
    expect(
      findInlineDocumentSites("const note = `gql('query A { a }')`;\n"),
    ).toEqual([]);
  });

  it('finds a document that follows a comment holding a tag', () => {
    const content = [
      '// const old = gql`query Old { a }`;',
      '/* const older = gql`query Older { a }`; */',
      'const q = gql`query A { a }`;',
    ].join('\n');

    const sites = findInlineDocumentSites(content);

    expect(sites.map((site) => site.body)).toEqual(['query A { a }']);
    expect(sites[0].line).toBe(3);
  });

  it('finds a document that follows an interpolated template literal', () => {
    const content = [
      'const label = `${count > 0 ? `${count} left` : "none"} total`;',
      'const q = gql`query A { a }`;',
    ].join('\n');

    expect(findInlineDocumentSites(content).map((site) => site.body)).toEqual([
      'query A { a }',
    ]);
  });

  it('keeps its place across an apostrophe in a line comment', () => {
    const content = [
      "// don't look in here",
      'const q = gql`query A { a }`;',
    ].join('\n');

    expect(
      findInlineDocumentSites(content).map((site) => site.identifier),
    ).toEqual(['q']);
  });

  it('reads a helper call that takes more arguments after the document', () => {
    const content =
      "const q = graphql('query A { a }', { fetchPolicy: 'no-cache' });";

    const sites = findInlineDocumentSites(content);

    expect(sites.map((site) => site.body)).toEqual(['query A { a }']);
    expect(sites[0].blankRanges).toEqual([
      { start: 0, end: content.length - 1 },
    ]);
  });

  it('reads past comments and nested parentheses in the argument list', () => {
    const content = [
      "const q = graphql('query A { a }' /* doc */, // options",
      '  opts(1, 2));',
    ].join('\n');

    const sites = findInlineDocumentSites(content);

    expect(sites.map((site) => site.body)).toEqual(['query A { a }']);
    expect(sites[0].blankRanges).toEqual([
      { start: 0, end: content.length - 1 },
    ]);
  });

  it('stops at the closing quote when the call never closes', () => {
    const content = "const q = graphql('query A { a }'";

    const sites = findInlineDocumentSites(content);

    expect(sites.map((site) => site.body)).toEqual(['query A { a }']);
    expect(sites[0].blankRanges).toEqual([{ start: 0, end: content.length }]);
  });

  it('does not end an ordinary string at an escaped quote', () => {
    const content = [
      "const s = 'it\\'s here';",
      'const q = gql`query A { a }`;',
    ].join('\n');

    expect(
      findInlineDocumentSites(content).map((site) => site.identifier),
    ).toEqual(['q']);
  });

  it('swallows the rest of the file at an unterminated block comment', () => {
    expect(
      findInlineDocumentSites('/* unfinished\nconst q = gql`query A { a }`;\n'),
    ).toEqual([]);
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

  it('blanks the trailing arguments of a helper call too', () => {
    const content =
      "const q = graphql('query A { a }', { fetchPolicy: 'no-cache' });";

    const { blankedContent } = extractInlineDocuments('src/App.tsx', content);

    expect(blankedContent).toBe(' '.repeat(content.length - 1) + ';');
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

describe('a multi-line type annotation', () => {
  it('still captures the constant the document is assigned to', () => {
    // What Prettier and codegen produce once the annotation passes the print
    // width. Losing the identifier here loses the only usage signal the client
    // preset has.
    const content = [
      'export const GetUserDoc: TypedDocumentNode<',
      '  GetUserQuery,',
      '  GetUserQueryVariables',
      '> = graphql(`query GetUser { user { id } }`);',
    ].join('\n');

    const sites = findInlineDocumentSites(content);

    expect(sites).toHaveLength(1);
    expect(sites[0].identifier).toBe('GetUserDoc');
  });
});

describe('a body that does not parse', () => {
  it('is left in the usage corpus instead of being blanked away', () => {
    // A half-written template is normal while editing. Blanking it erases the
    // fragment spreads it mentions, so a fragment it was the only consumer of
    // gets reported unused at high confidence.
    const content =
      'const broken = gql`query Half { ...UserFields`;\nconst ok = 1;';

    const extraction = extractInlineDocuments('src/App.tsx', content);

    expect(extraction.skipped).toBe(1);
    expect(extraction.documents).toEqual([]);
    expect(extraction.blankedContent).toContain('UserFields');
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

  it('keeps a document that is consumed where it is written', () => {
    // The plain Apollo idiom: the document is an argument, so the code that
    // defines it is the code that uses it. Its own statement is blanked out of
    // the corpus, so nothing else can ever vouch for it.
    const entities = entitiesFor('useQuery(gql`query GetUser { id }`);');

    const usage = findInlineIdentifierUsage(entities, [
      { file: 'src/App.tsx', content: 'useQuery();' },
    ]);

    expect(usage).toHaveLength(1);
    expect(usage[0].operations).toEqual(['GetUser']);
    expect(usage[0].file).toBe('src/App.tsx');
  });

  it('still reports a document standing alone as a statement', () => {
    const entities = entitiesFor('graphql(`query GetUser { id }`);');

    expect(
      findInlineIdentifierUsage(entities, [
        { file: 'src/App.tsx', content: ';' },
      ]),
    ).toEqual([]);
  });

  it("does not let another file's same-named constant vouch for a document", () => {
    // Both files call their document `query`, which is what the client preset
    // encourages. b.tsx uses its own; that must not keep a.tsx's dead document
    // alive.
    const dead = toInlineEntities(
      extractInlineDocuments(
        'src/a.tsx',
        'const query = graphql(`query DeadOne { a }`);',
      ).documents,
    );
    const live = toInlineEntities(
      extractInlineDocuments(
        'src/b.tsx',
        'const query = graphql(`query LiveOne { b }`);\nuseQuery(query);',
      ).documents,
    );
    const sources = [
      { file: 'src/a.tsx', content: '' },
      { file: 'src/b.tsx', content: '\nuseQuery(query);' },
    ];

    // The real scan grades every inline file in one call, which is what lets
    // it see that both files claim the name.
    const usage = findInlineIdentifierUsage([...dead, ...live], sources);

    expect(usage.flatMap((entry) => entry.operations)).toEqual(['LiveOne']);
  });
});
