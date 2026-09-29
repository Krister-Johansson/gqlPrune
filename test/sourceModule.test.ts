// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import path from 'path';
import ts from 'typescript';
import {
  buildSourceModule,
  parseSourceModule,
  scriptKindFor,
  tokenizeSourceModule,
} from '../src/utils/sourceModule';
import type { Reference } from '../src/utils/sourceModule';

function refs(content: string, file = 'src/App.tsx'): Reference[] {
  return parseSourceModule(file, content).references;
}

function names(content: string, file = 'src/App.tsx'): string[] {
  return refs(content, file).map((ref) => ref.name);
}

describe('scriptKindFor', () => {
  it.each([
    ['a.ts', ts.ScriptKind.TS],
    ['a.mts', ts.ScriptKind.TS],
    ['a.cts', ts.ScriptKind.TS],
    ['a.tsx', ts.ScriptKind.TSX],
    ['a.js', ts.ScriptKind.JS],
    ['a.mjs', ts.ScriptKind.JS],
    ['a.cjs', ts.ScriptKind.JS],
    ['a.jsx', ts.ScriptKind.JSX],
  ])('maps %s to a script kind', (file, kind) => {
    expect(scriptKindFor(file)).toBe(kind);
  });

  it('is case-insensitive about the extension', () => {
    expect(scriptKindFor('A.TSX')).toBe(ts.ScriptKind.TSX);
  });

  it('returns undefined for anything the parser cannot take', () => {
    expect(scriptKindFor('App.vue')).toBeUndefined();
    expect(scriptKindFor('page.svelte')).toBeUndefined();
    expect(scriptKindFor('schema.graphql')).toBeUndefined();
  });
});

describe('parseSourceModule', () => {
  it('keys the module by its resolved posix path and keeps the file as given', () => {
    const module = parseSourceModule('src/App.tsx', 'export {};');

    expect(module.file).toBe('src/App.tsx');
    expect(module.path).toBe(
      path.resolve('src/App.tsx').split(path.sep).join('/'),
    );
    expect(module.mode).toBe('module');
    expect(module.syntaxErrors).toBe(0);
  });

  describe('imports', () => {
    it('records a named import under its local name', () => {
      const { imports } = parseSourceModule(
        'a.ts',
        "import { useGetUserQuery } from './hooks';",
      );

      expect(imports.get('useGetUserQuery')).toEqual({
        local: 'useGetUserQuery',
        imported: 'useGetUserQuery',
        specifier: './hooks',
        kind: 'named',
      });
    });

    it('records a renamed import under the local name with the imported name kept', () => {
      const { imports } = parseSourceModule(
        'a.ts',
        "import { GetUserDocument as Doc } from './generated';",
      );

      expect(imports.get('Doc')).toEqual({
        local: 'Doc',
        imported: 'GetUserDocument',
        specifier: './generated',
        kind: 'named',
      });
      expect(imports.has('GetUserDocument')).toBe(false);
    });

    it('records a default import', () => {
      const { imports } = parseSourceModule('a.ts', "import doc from './doc';");

      expect(imports.get('doc')).toEqual({
        local: 'doc',
        specifier: './doc',
        kind: 'default',
      });
    });

    it('records a namespace import', () => {
      const { imports } = parseSourceModule(
        'a.ts',
        "import * as api from './api';",
      );

      expect(imports.get('api')).toEqual({
        local: 'api',
        specifier: './api',
        kind: 'namespace',
      });
    });

    it('records a default and named imports from one declaration', () => {
      const { imports } = parseSourceModule(
        'a.ts',
        "import React, { useState as useS, useEffect } from 'react';",
      );

      expect([...imports.keys()]).toEqual(['React', 'useS', 'useEffect']);
    });

    it('records a type-only import like a value import', () => {
      const { imports } = parseSourceModule(
        'a.ts',
        "import type { GetThingGQL } from './generated';",
      );

      expect(imports.get('GetThingGQL')?.imported).toBe('GetThingGQL');
    });

    it('records a side-effect import as no binding', () => {
      expect(
        parseSourceModule('a.ts', "import './polyfill';").imports.size,
      ).toBe(0);
    });

    it('records import equals require as a namespace binding', () => {
      const { imports } = parseSourceModule(
        'a.ts',
        "import api = require('./api');",
      );

      expect(imports.get('api')).toEqual({
        local: 'api',
        specifier: './api',
        kind: 'namespace',
      });
    });

    it('records a destructured require as named bindings', () => {
      const { imports } = parseSourceModule(
        'a.cjs',
        "const { useGetUserQuery, GetUserDocument: Doc } = require('./hooks');",
      );

      expect(imports.get('useGetUserQuery')?.imported).toBe('useGetUserQuery');
      expect(imports.get('Doc')).toEqual({
        local: 'Doc',
        imported: 'GetUserDocument',
        specifier: './hooks',
        kind: 'named',
      });
    });

    it('records a whole-module require as a namespace binding', () => {
      const { imports } = parseSourceModule(
        'a.cjs',
        "const api = require('./api');",
      );

      expect(imports.get('api')?.kind).toBe('namespace');
    });

    it('does not treat a require with a computed argument as an import', () => {
      const { imports } = parseSourceModule(
        'a.cjs',
        'const api = require(name);',
      );

      expect(imports.size).toBe(0);
    });

    it('does not list import bindings as declarations or references', () => {
      const module = parseSourceModule(
        'a.ts',
        "import { useGetUserQuery } from './hooks';\nimport * as api from './api';",
      );

      expect(module.declarations.size).toBe(0);
      expect(module.references).toEqual([]);
    });
  });

  describe('exports', () => {
    it('records export const as a local export', () => {
      const { exports } = parseSourceModule('a.ts', 'export const X = 1;');

      expect(exports.get('X')).toEqual({
        kind: 'local',
        exported: 'X',
        local: 'X',
      });
    });

    it('records exported functions, classes, types, interfaces and enums', () => {
      const { exports } = parseSourceModule(
        'a.ts',
        [
          'export function f() {}',
          'export class C {}',
          'export type T = 1;',
          'export interface I {}',
          'export enum E { A }',
        ].join('\n'),
      );

      expect([...exports.keys()]).toEqual(['f', 'C', 'T', 'I', 'E']);
    });

    it('records every name of an exported destructuring declaration', () => {
      const { exports } = parseSourceModule(
        'a.ts',
        'export const { a, b: c } = o;\nexport const [d] = arr;',
      );

      expect([...exports.keys()]).toEqual(['a', 'c', 'd']);
    });

    it('records export { a, b as c } of local declarations', () => {
      const { exports } = parseSourceModule(
        'a.ts',
        'const a = 1;\nconst b = 2;\nexport { a, b as c };',
      );

      expect(exports.get('a')).toEqual({
        kind: 'local',
        exported: 'a',
        local: 'a',
      });
      expect(exports.get('c')).toEqual({
        kind: 'local',
        exported: 'c',
        local: 'b',
      });
    });

    it('records export { a as default }', () => {
      const { exports } = parseSourceModule(
        'a.ts',
        'const a = 1;\nexport { a as default };',
      );

      expect(exports.get('default')).toEqual({
        kind: 'local',
        exported: 'default',
        local: 'a',
      });
    });

    it('records export { a as b } from as a re-export', () => {
      const { exports } = parseSourceModule(
        'a.ts',
        "export { GetUserDocument as Doc, useGetUserQuery } from './generated';",
      );

      expect(exports.get('Doc')).toEqual({
        kind: 'reexport',
        exported: 'Doc',
        specifier: './generated',
        imported: 'GetUserDocument',
      });
      expect(exports.get('useGetUserQuery')?.kind).toBe('reexport');
    });

    it('records export { default as X } from and export { default } from', () => {
      const { exports } = parseSourceModule(
        'a.ts',
        "export { default as X } from './x';\nexport { default } from './y';",
      );

      expect(exports.get('X')).toEqual({
        kind: 'reexport',
        exported: 'X',
        specifier: './x',
        imported: 'default',
      });
      expect(exports.get('default')).toEqual({
        kind: 'reexport',
        exported: 'default',
        specifier: './y',
        imported: 'default',
      });
    });

    it('records export * from as a star export in order', () => {
      const { starExports } = parseSourceModule(
        'a.ts',
        "export * from './a';\nexport * from './b';",
      );

      expect(starExports).toEqual(['./a', './b']);
    });

    it('records export * as ns from as a namespace export', () => {
      const { exports } = parseSourceModule(
        'a.ts',
        "export * as api from './api';",
      );

      expect(exports.get('api')).toEqual({
        kind: 'namespace',
        exported: 'api',
        specifier: './api',
      });
    });

    it('records export default of an identifier as a local export, not a reference', () => {
      const module = parseSourceModule(
        'a.ts',
        "import { GetUserDocument } from './generated';\nexport default GetUserDocument;",
      );

      expect(module.exports.get('default')).toEqual({
        kind: 'local',
        exported: 'default',
        local: 'GetUserDocument',
      });
      expect(module.references).toEqual([]);
    });

    it('records export default function and class by their names', () => {
      const { exports } = parseSourceModule(
        'a.ts',
        'export default function useX() {}',
      );
      const classy = parseSourceModule(
        'b.ts',
        'export default class Store {}',
      ).exports;

      expect(exports.get('default')).toEqual({
        kind: 'local',
        exported: 'default',
        local: 'useX',
      });
      expect(classy.get('default')).toEqual({
        kind: 'local',
        exported: 'default',
        local: 'Store',
      });
    });

    it('records an anonymous default export with no local name', () => {
      const anonymous = parseSourceModule(
        'a.ts',
        'export default function () {}',
      );
      const object = parseSourceModule('b.ts', 'export default { a: 1 };');
      const template = parseSourceModule(
        'c.ts',
        'export default gql`query A { a }`;',
      );

      expect(anonymous.exports.get('default')).toEqual({
        kind: 'local',
        exported: 'default',
      });
      expect(object.exports.get('default')).toEqual({
        kind: 'local',
        exported: 'default',
      });
      expect(template.exports.get('default')).toEqual({
        kind: 'local',
        exported: 'default',
      });
    });

    it('walks the expression of a non-identifier default export for references', () => {
      expect(
        names('export default useQuery(GetUserDocument);', 'a.ts'),
      ).toEqual(['useQuery', 'GetUserDocument']);
    });

    it('does not list export specifiers as references', () => {
      const module = parseSourceModule(
        'a.ts',
        "const a = 1;\nexport { a };\nexport { b } from './b';",
      );

      expect(module.references).toEqual([]);
    });
  });

  describe('declarations', () => {
    it('collects every declared name and never reports one as a reference', () => {
      const module = parseSourceModule(
        'a.ts',
        [
          'const GetUserDocument = 1;',
          'let { a, b: c } = o;',
          'function useGetUserQuery(param) {}',
          'class Store { field = 1; method() {} }',
          'interface Shape { key: string }',
          'type Alias<T> = T;',
          'enum Level { Low }',
          'namespace NS {}',
        ].join('\n'),
      );

      expect([...module.declarations]).toEqual([
        'GetUserDocument',
        'a',
        'c',
        'useGetUserQuery',
        'param',
        'Store',
        'field',
        'method',
        'Shape',
        'Alias',
        'T',
        'Level',
        'NS',
      ]);
      expect(module.references.map((ref) => ref.name)).toEqual(['o', 'T']);
    });
  });

  describe('references', () => {
    it('records a bare call with its line and column', () => {
      expect(refs('\n  useGetUserQuery();')).toEqual([
        { name: 'useGetUserQuery', kind: 'expression', line: 2, column: 3 },
      ]);
    });

    it.each([
      [
        'a call argument',
        'useQuery(GetUserDocument);',
        ['useQuery', 'GetUserDocument'],
      ],
      ['an initializer', 'const x = GetUserDocument;', ['GetUserDocument']],
      ['a spread', 'const x = [...docs];', ['docs']],
      [
        'a computed key',
        'const x = { [GetUserDocument]: 1 };',
        ['GetUserDocument'],
      ],
      [
        'a return',
        'function f() { return GetUserDocument; }',
        ['GetUserDocument'],
      ],
      [
        'a template interpolation',
        'const s = `${GetUserDocument}`;',
        ['GetUserDocument'],
      ],
      [
        'an await and a condition',
        'if (ready) await load(GetUserDocument);',
        ['ready', 'load', 'GetUserDocument'],
      ],
      ['a decorator', '@Component({}) class C {}', ['Component']],
      [
        'a JSX expression container',
        'const el = <div>{result.data}</div>;',
        ['div', 'result', 'data', 'div'],
      ],
      [
        'an assignment target',
        'cache = GetUserDocument;',
        ['cache', 'GetUserDocument'],
      ],
    ])('records an identifier in %s', (_label, content, expected) => {
      expect(names(content)).toEqual(expected);
    });

    it('records a shorthand property as a reference', () => {
      expect(refs('const o = { GetUserDocument };')).toEqual([
        { name: 'GetUserDocument', kind: 'shorthand', line: 1, column: 13 },
      ]);
    });

    it('records a property access name with its base', () => {
      expect(refs('api.useGetUserQuery();')).toEqual([
        { name: 'api', kind: 'expression', line: 1, column: 1 },
        {
          name: 'useGetUserQuery',
          base: 'api',
          kind: 'member',
          line: 1,
          column: 5,
        },
      ]);
    });

    it('records deeper member chains without a base past the first hop', () => {
      expect(refs('a.b.c();')).toEqual([
        { name: 'a', kind: 'expression', line: 1, column: 1 },
        { name: 'b', base: 'a', kind: 'member', line: 1, column: 3 },
        { name: 'c', kind: 'member', line: 1, column: 5 },
      ]);
    });

    it('records a type reference, including one on a constructor parameter', () => {
      expect(
        refs(
          'class S { constructor(private readonly g: GetThingGQL) {} }',
          'a.ts',
        ),
      ).toEqual([{ name: 'GetThingGQL', kind: 'type', line: 1, column: 43 }]);
    });

    it('records a qualified type name as a member with a base', () => {
      expect(refs('let x: api.GetUserQuery;', 'a.ts')).toEqual([
        { name: 'api', kind: 'type', line: 1, column: 8 },
        {
          name: 'GetUserQuery',
          base: 'api',
          kind: 'member',
          line: 1,
          column: 12,
        },
      ]);
    });

    it('records typeof, heritage clauses, type arguments and as-expressions', () => {
      expect(
        names(
          [
            'let a: typeof GetUserDocument;',
            'class C extends Base implements Shape {}',
            'let b: Array<Doc>;',
            'const c = x as Doc;',
            'const d = y satisfies Doc;',
          ].join('\n'),
          'a.ts',
        ),
      ).toEqual([
        'GetUserDocument',
        'Base',
        'Shape',
        'Array',
        'Doc',
        'x',
        'Doc',
        'y',
        'Doc',
      ]);
    });

    it('records JSX tag names', () => {
      expect(refs('const el = <UserCard />;')).toEqual([
        { name: 'UserCard', kind: 'jsx', line: 1, column: 13 },
      ]);
      expect(names('const el = <ui.Card>x</ui.Card>;')).toEqual([
        'ui',
        'Card',
        'ui',
        'Card',
      ]);
    });

    it.each([
      ['a variable declaration name', 'const GetUserDocument = 1;'],
      [
        'a function or class name',
        'function useGetUserQuery() {}\nclass GetUserDocument {}',
      ],
      ['a parameter name', 'function f(GetUserDocument) {}'],
      [
        'a property declaration or method name',
        'class C { GetUserDocument = 1; useGetUserQuery() {} }',
      ],
      ['an import specifier', "import { useGetUserQuery } from './hooks';"],
      ['an export specifier', "export { useGetUserQuery } from './hooks';"],
      [
        'an object literal key',
        'const o = { GetUserDocument: 1, useGetUserQuery() {} };',
      ],
      [
        'a binding element property name',
        'const { GetUserDocument: doc } = o;',
      ],
      [
        'a property signature',
        'interface I { GetUserDocument: string; useGetUserQuery(): void }',
      ],
      ['a JSX attribute name', 'const el = <div GetUserDocument="1" />;'],
      ['a label', 'GetUserDocument: for (;;) { break GetUserDocument; }'],
      [
        'a line or block comment',
        '// useGetUserQuery()\n/* GetUserDocument */',
      ],
      [
        'a string or template literal',
        "const s = ['useGetUserQuery', `GetUserDocument`];",
      ],
      ['an enum member', 'enum E { GetUserDocument }'],
      ['a type parameter', 'type T<GetUserDocument> = 1;'],
    ])('does not record %s', (_label, content) => {
      const found = names(content).filter((name) =>
        ['GetUserDocument', 'useGetUserQuery'].includes(name),
      );

      expect(found).toEqual([]);
    });

    it('does not record the object of a property access as a member', () => {
      const kinds = refs('a.GetUserDocument;').map(
        (ref) => `${ref.name}:${ref.kind}`,
      );

      expect(kinds).toEqual(['a:expression', 'GetUserDocument:member']);
    });

    it('collects declared and referenced names into identifiers', () => {
      const module = parseSourceModule(
        'a.ts',
        "import { x } from './x';\nconst GetUserDocument = 1;\nuseGetUserQuery();",
      );

      expect([...module.identifiers]).toEqual([
        'GetUserDocument',
        'useGetUserQuery',
      ]);
    });
  });

  describe('string words', () => {
    it('collects identifier-shaped words from strings and templates', () => {
      const module = parseSourceModule(
        'a.ts',
        'const s = [\'GetUser\', `event:${x}-GetLegacy`, "a-b"];',
      );

      expect([...module.stringWords].sort()).toEqual([
        'GetLegacy',
        'GetUser',
        'a',
        'b',
        'event',
      ]);
    });

    it('does not collect module specifiers', () => {
      const module = parseSourceModule(
        'a.ts',
        "import { a } from './GetUser';\nexport { b } from './GetLegacy';",
      );

      expect(module.stringWords.size).toBe(0);
    });

    it('keeps words inside an inline document body apart from other strings', () => {
      const module = parseSourceModule(
        'a.ts',
        "const q = gql`query GetUser { id }`;\nconst s = 'GetLegacy';",
      );

      expect([...module.siteWords].sort()).toEqual(['GetUser', 'id', 'query']);
      expect([...module.stringWords]).toEqual(['GetLegacy']);
    });
  });

  describe('inline sites', () => {
    function sites(content: string, file = 'src/documents.ts') {
      return parseSourceModule(file, content).inlineSites;
    }

    it('finds a gql tagged template with its body and identifier', () => {
      const found = sites('const q = gql`query GetUser { user { id } }`;\n');

      expect(found).toHaveLength(1);
      expect(found[0].body).toBe('query GetUser { user { id } }');
      expect(found[0].identifier).toBe('q');
      expect(found[0].consumed).toBe(false);
    });

    it('finds graphql tags and tags reached through a member expression', () => {
      expect(sites('graphql`query A { a }`').map((s) => s.body)).toEqual([
        'query A { a }',
      ]);
      expect(sites('apollo.gql`query A { a }`').map((s) => s.body)).toEqual([
        'query A { a }',
      ]);
    });

    it.each([
      ["const q = graphql('query A { a }');"],
      ['const q = graphql("query A { a }");'],
      ['const q = gql(`query A { a }`);'],
    ])('finds a helper call: %s', (content) => {
      const found = sites(content);

      expect(found.map((s) => s.body)).toEqual(['query A { a }']);
      expect(found[0].identifier).toBe('q');
    });

    it('reads a helper call that takes more arguments after the document', () => {
      const found = sites("graphql('query A { a }', { fragments: [] });");

      expect(found.map((s) => s.body)).toEqual(['query A { a }']);
    });

    it('ignores a helper call whose first argument is not a literal', () => {
      expect(sites('graphql(source);')).toEqual([]);
      expect(sites('graphql();')).toEqual([]);
    });

    it('captures the identifier of an exported constant', () => {
      expect(
        sites(
          'export const GetUserDocument = graphql(`query GetUser { id }`);',
        )[0].identifier,
      ).toBe('GetUserDocument');
    });

    it('captures the identifier through a type annotation, a cast and parentheses', () => {
      expect(
        sites('const q: TypedDocumentNode<A,\n B> = gql`query A { a }`;')[0]
          .identifier,
      ).toBe('q');
      expect(
        sites('const q = (gql`query A { a }`) as Doc;')[0].identifier,
      ).toBe('q');
      expect(
        sites('const q = gql`query A { a }` satisfies Doc;')[0].identifier,
      ).toBe('q');
      expect(sites('const q = gql`query A { a }`!;')[0].identifier).toBe('q');
    });

    it('marks a document written straight into a call as consumed', () => {
      const found = sites('useQuery(gql`query A { a }`);');

      expect(found[0].identifier).toBeUndefined();
      expect(found[0].consumed).toBe(true);
    });

    it.each([
      ['an array element', 'const docs = [gql`query A { a }`];'],
      ['a property value', 'const o = { doc: gql`query A { a }` };'],
      ['a return', 'function f() { return gql`query A { a }`; }'],
      ['an export default', 'export default gql`query A { a }`;'],
      ['an assignment', 'cache.doc = gql`query A { a }`;'],
    ])('marks a document used as %s as consumed', (_label, content) => {
      expect(sites(content)[0].consumed).toBe(true);
    });

    it('marks a document standing alone as a statement as not consumed', () => {
      const found = sites('gql`query A { a }`;');

      expect(found[0].identifier).toBeUndefined();
      expect(found[0].consumed).toBe(false);
    });

    it('reports the line and column the body starts on', () => {
      const content = [
        '// header',
        '',
        'const q = gql`',
        '  query A { a }',
        '`;',
      ].join('\n');

      const found = sites(content);

      expect(found[0].line).toBe(3);
      expect(found[0].column).toBe('const q = gql`'.length + 1);
    });

    it('blanks interpolations without changing the body length', () => {
      const content = 'const q = gql`query A { ...F }\n${FDoc}\n`;';

      const found = sites(content);

      expect(found[0].body).toBe('query A { ...F }\n       \n');
      expect(found[0].body).toHaveLength('query A { ...F }\n${FDoc}\n'.length);
    });

    it('records the interpolated names as references', () => {
      expect(
        names('const q = gql`query A { ...F }\n${FDoc}\n`;', 'a.ts'),
      ).toEqual(['gql', 'FDoc']);
    });

    it('keeps escape sequences at their raw length', () => {
      const found = sites('const q = gql`query A { a(s: "\\u0041") }`;');

      expect(found[0].body).toBe('query A { a(s: "\\u0041") }');
    });

    it('records the text range of the body in the file', () => {
      const content = 'const q = gql`query A { a }`;';

      const [site] = sites(content);

      expect(content.slice(site.textRange.start, site.textRange.end)).toBe(
        'query A { a }',
      );
    });

    it.each([
      [
        'a graphql import specifier',
        "import { parse } from 'graphql';\nconst x = require('graphql');",
      ],
      ['a tag whose name only ends with gql', 'mygql`query A { a }`'],
      ['a tag inside a line comment', '// gql`query A { a }`'],
      ['a tag inside a block comment', '/* gql`query A { a }` */'],
      [
        'a tag inside a string',
        "const s = 'gql`query A { a }`';\nconst t = `gql\\`query A { a }\\``;",
      ],
      ['a file without GraphQL', 'export const x = 1;'],
    ])('finds nothing in %s', (_label, content) => {
      expect(sites(content)).toEqual([]);
    });

    it('finds several documents in one file in order', () => {
      const found = sites(
        [
          'const a = gql`query A { a }`;',
          'useQuery(graphql(`query B { b }`));',
        ].join('\n'),
      );

      expect(found.map((s) => s.body)).toEqual([
        'query A { a }',
        'query B { b }',
      ]);
      expect(found.map((s) => s.line)).toEqual([1, 2]);
    });
  });

  describe('parse errors', () => {
    it('never throws, counts the errors and keeps the references it could read', () => {
      const module = parseSourceModule(
        'a.ts',
        'const n = ;\nuseGetUserQuery();',
      );

      expect(module.syntaxErrors).toBeGreaterThan(0);
      expect(module.references.map((ref) => ref.name)).toContain(
        'useGetUserQuery',
      );
    });

    it('parses JSX in a .tsx file and not in a .ts file', () => {
      expect(
        parseSourceModule('a.tsx', 'const el = <div />;').syntaxErrors,
      ).toBe(0);
      expect(
        parseSourceModule('a.ts', 'const el = <div />;').syntaxErrors,
      ).toBeGreaterThan(0);
    });
  });
});

describe('tokenizeSourceModule', () => {
  it('records every identifier token as a reference and nothing else', () => {
    const module = tokenizeSourceModule(
      'App.vue',
      [
        '<script setup lang="ts">',
        "import { useVueUserQuery } from './generated';",
        'const { data } = useVueUserQuery();',
        '</script>',
        '<template>{{ data }}</template>',
      ].join('\n'),
    );

    expect(module.mode).toBe('tokens');
    expect(module.imports.size).toBe(0);
    expect(module.declarations.size).toBe(0);
    expect(module.references.map((ref) => ref.name)).toEqual(
      expect.arrayContaining(['useVueUserQuery', 'data', 'template']),
    );
    expect(module.references.every((ref) => ref.kind === 'token')).toBe(true);
    expect(
      module.references.find((ref) => ref.name === 'useVueUserQuery'),
    ).toEqual({
      name: 'useVueUserQuery',
      kind: 'token',
      line: 2,
      column: 10,
    });
  });

  it('skips comments and puts string contents into string words', () => {
    const module = tokenizeSourceModule(
      'a.vue',
      "// GetUser\nconst s = 'GetLegacy';",
    );

    expect(module.references.map((ref) => ref.name)).toEqual(['s']);
    expect([...module.stringWords]).toEqual(['GetLegacy']);
  });

  it('reads a template literal with interpolations', () => {
    const module = tokenizeSourceModule(
      'a.vue',
      'const s = `a ${useX()} b`; useY();',
    );

    expect(module.references.map((ref) => ref.name)).toEqual([
      's',
      'useX',
      'useY',
    ]);
    expect([...module.stringWords].sort()).toEqual(['a', 'b']);
  });

  it('does not read identifiers out of a regular expression', () => {
    const module = tokenizeSourceModule('a.vue', 'const re = /useX"/; useY();');

    expect(module.references.map((ref) => ref.name)).toEqual(['re', 'useY']);
  });

  it('finds no inline document sites', () => {
    expect(
      tokenizeSourceModule('a.vue', 'const q = gql`query A { a }`;')
        .inlineSites,
    ).toEqual([]);
  });
});

describe('buildSourceModule', () => {
  it('parses files the compiler knows and tokenizes the rest', () => {
    expect(buildSourceModule('a.ts', 'x();').mode).toBe('module');
    expect(buildSourceModule('a.vue', 'x();').mode).toBe('tokens');
  });
});
