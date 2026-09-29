// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  createCorpusResolver,
  createMapResolver,
} from '../src/utils/moduleResolver';
import type { ModuleResolver } from '../src/utils/moduleResolver';
import {
  buildReferenceIndex,
  describeResolution,
} from '../src/utils/referenceIndex';
import type { ReferenceIndex } from '../src/utils/referenceIndex';
import { parseSourceModule } from '../src/utils/sourceModule';

/** Builds an index over in-memory files keyed by absolute posix path. */
function indexOf(
  files: Record<string, string>,
  options: { inline?: boolean; resolver?: ModuleResolver } = {},
): ReferenceIndex {
  const modules = Object.entries(files).map(([file, content]) =>
    parseSourceModule(file, content),
  );
  return buildReferenceIndex(
    modules,
    options.resolver ?? createCorpusResolver(Object.keys(files)),
    { inline: options.inline ?? false },
  );
}

function canonicalOf(index: ReferenceIndex, name: string) {
  return index.byName.get(name)?.map((ref) => ({
    file: ref.file,
    origin: ref.canonical.origin,
  }));
}

describe('buildReferenceIndex', () => {
  describe('canonical names', () => {
    it('gives a bare unbound identifier its own name', () => {
      const index = indexOf({ '/p/App.tsx': 'useGetUserQuery();' });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: 'unbound' },
      ]);
    });

    it('gives a same-file declaration the file as origin', () => {
      const index = indexOf({
        '/p/App.tsx': 'const useGetUserQuery = () => 1;\nuseGetUserQuery();',
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: '/p/App.tsx' },
      ]);
    });

    it('gives an import from an unresolvable specifier the imported name', () => {
      const index = indexOf({
        '/p/App.tsx':
          "import { GetUserDocument as Doc } from '@acme/graphql';\nuseQuery(Doc);",
      });

      expect(canonicalOf(index, 'GetUserDocument')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
      expect(index.byName.has('Doc')).toBe(false);
    });

    it('resolves a named import to the exporting file and name', () => {
      const index = indexOf({
        '/p/hooks.ts': 'export const useGetUserQuery = () => 1;',
        '/p/App.tsx':
          "import { useGetUserQuery } from './hooks';\nuseGetUserQuery();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: '/p/hooks.ts' },
      ]);
    });

    it('resolves a renamed import to the original exported name', () => {
      const index = indexOf({
        '/p/docs.ts': 'export const GetUserDocument = {};',
        '/p/App.tsx':
          "import { GetUserDocument as Doc } from './docs';\nuseQuery(Doc);",
      });

      expect(canonicalOf(index, 'GetUserDocument')).toEqual([
        { file: '/p/App.tsx', origin: '/p/docs.ts' },
      ]);
    });

    it('resolves a re-export of an imported binding through to its source', () => {
      const index = indexOf({
        '/p/api/docs.ts':
          "import { GetUserDocument } from '../generated/graphql';\nexport { GetUserDocument };",
        '/p/App.tsx':
          "import { GetUserDocument } from './api/docs';\nuseQuery(GetUserDocument);",
      });

      expect(canonicalOf(index, 'GetUserDocument')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
    });

    it('follows export { a as b } from and keeps the original name', () => {
      const index = indexOf({
        '/p/api/docs.ts':
          "export { GetUserDocument as UserDoc } from '../generated/graphql';",
        '/p/App.tsx':
          "import { UserDoc } from './api/docs';\nuseQuery(UserDoc);",
      });

      expect(canonicalOf(index, 'GetUserDocument')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
    });

    it('follows a barrel index.ts through export *', () => {
      const index = indexOf({
        '/p/api/index.ts': "export * from './hooks';",
        '/p/api/hooks.ts':
          "export { useGetUserQuery } from '../generated/graphql';",
        '/p/App.tsx':
          "import { useGetUserQuery } from './api';\nuseGetUserQuery();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
    });

    it('follows a chain of export * and takes the first match', () => {
      const index = indexOf({
        '/p/a.ts': "export * from './b';\nexport * from './c';",
        '/p/b.ts': "export * from './d';",
        '/p/c.ts': 'export const useGetUserQuery = 2;',
        '/p/d.ts': 'export const useGetUserQuery = 1;',
        '/p/App.tsx':
          "import { useGetUserQuery } from './a';\nuseGetUserQuery();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: '/p/d.ts' },
      ]);
    });

    it('prefers a local export over a star re-export of the same name', () => {
      const index = indexOf({
        '/p/a.ts': "export * from './b';\nexport const useGetUserQuery = 1;",
        '/p/b.ts': 'export const useGetUserQuery = 2;',
        '/p/App.tsx':
          "import { useGetUserQuery } from './a';\nuseGetUserQuery();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: '/p/a.ts' },
      ]);
    });

    it('terminates on an export * cycle and still finds the export', () => {
      const index = indexOf({
        '/p/a.ts':
          "export * from './b';\nexport { useGetUserQuery } from '../generated/graphql';",
        '/p/b.ts': "export * from './a';",
        '/p/App.tsx':
          "import { useGetUserQuery, useNothingQuery } from './b';\nuseGetUserQuery();\nuseNothingQuery();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
      expect(canonicalOf(index, 'useNothingQuery')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
    });

    it('terminates on a cycle of re-exported imports', () => {
      // Each file imports X from the other and re-exports it; nothing declares
      // it. The chain is cut and reported, never followed forever.
      const index = indexOf({
        '/p/a.ts': "import { X } from './b';\nexport { X };",
        '/p/b.ts': "import { X } from './a';\nexport { X };",
        '/p/App.tsx': "import { X } from './a';\nuse(X);",
      });

      expect(canonicalOf(index, 'X')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
      const [ref] = index.byName.get('X') ?? [];
      const chain = describeResolution(ref.canonical);
      expect(chain[0]).toContain("imported from './a'");
      expect(chain[chain.length - 1]).toContain('no export named X');
    });

    it('gives each importer of an anonymous default its own name', () => {
      const index = indexOf({
        '/p/doc.ts': 'export default gql`query A { a }`;',
        '/p/A.tsx':
          "import GetUserDocument from './doc';\nuseQuery(GetUserDocument);",
        '/p/B.tsx':
          "import GetOtherDocument from './doc';\nuseQuery(GetOtherDocument);",
      });

      expect(canonicalOf(index, 'GetUserDocument')).toEqual([
        { file: '/p/A.tsx', origin: '/p/doc.ts' },
      ]);
      expect(canonicalOf(index, 'GetOtherDocument')).toEqual([
        { file: '/p/B.tsx', origin: '/p/doc.ts' },
      ]);
    });

    it('does not let a cycle cut poison the memo for a later importer', () => {
      // Resolving Y from a first meets b, whose star export points back at a
      // (cut), then finds Y in c. A later import of Y from b must find c too.
      const index = indexOf({
        '/p/a.ts': "export * from './b';\nexport * from './c';",
        '/p/b.ts': "export * from './a';",
        '/p/c.ts': 'export const Y = 1;',
        '/p/First.ts': "import { Y } from './a';\nuse(Y);",
        '/p/Second.ts': "import { Y } from './b';\nuse(Y);",
      });

      expect(canonicalOf(index, 'Y')).toEqual([
        { file: '/p/First.ts', origin: '/p/c.ts' },
        { file: '/p/Second.ts', origin: '/p/c.ts' },
      ]);
      expect(index.referencesTo('/p/c.ts', 'Y')).toHaveLength(2);
    });

    it('treats a name behind an export * that leaves the corpus as outside', () => {
      const index = indexOf({
        '/p/a.ts': "export * from '../generated/graphql';",
        '/p/App.tsx':
          "import { useGetUserQuery } from './a';\nuseGetUserQuery();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
    });

    it('keeps the imported name when the export does not exist anywhere', () => {
      const index = indexOf({
        '/p/a.ts': 'export const other = 1;',
        '/p/App.tsx':
          "import { useGetUserQuery } from './a';\nuseGetUserQuery();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
    });

    it('resolves a default import to the name behind export default', () => {
      const index = indexOf({
        '/p/doc.ts':
          "import { GetUserDocument } from '../generated/graphql';\nexport default GetUserDocument;",
        '/p/App.tsx': "import userDoc from './doc';\nuseQuery(userDoc);",
      });

      expect(canonicalOf(index, 'GetUserDocument')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
    });

    it('resolves a default import of a named function to that name', () => {
      const index = indexOf({
        '/p/hook.ts': 'export default function useGetUserQuery() {}',
        '/p/App.tsx': "import useUser from './hook';\nuseUser();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: '/p/hook.ts' },
      ]);
    });

    it('gives an anonymous default export the importing local name', () => {
      const index = indexOf({
        '/p/doc.ts': 'export default gql`query A { a }`;',
        '/p/App.tsx':
          "import GetUserDocument from './doc';\nuseQuery(GetUserDocument);",
      });

      expect(canonicalOf(index, 'GetUserDocument')).toEqual([
        { file: '/p/App.tsx', origin: '/p/doc.ts' },
      ]);
    });

    it('follows export { default as X } from', () => {
      const index = indexOf({
        '/p/doc.ts': 'export default function useGetUserQuery() {}',
        '/p/api.ts': "export { default as useUser } from './doc';",
        '/p/App.tsx': "import { useUser } from './api';\nuseUser();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: '/p/doc.ts' },
      ]);
    });

    it('resolves a namespace member to the export of the module', () => {
      const index = indexOf({
        '/p/api/docs.ts':
          "export { GetUserDocument } from '../generated/graphql';",
        '/p/App.tsx':
          "import * as docs from './api/docs';\nuseQuery(docs.GetUserDocument);",
      });

      expect(canonicalOf(index, 'GetUserDocument')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
      expect(index.byName.has('docs')).toBe(false);
    });

    it('resolves export * as ns from through the namespace', () => {
      const index = indexOf({
        '/p/hooks.ts': 'export const useGetUserQuery = () => 1;',
        '/p/api.ts': "export * as hooks from './hooks';",
        '/p/App.tsx':
          "import { hooks } from './api';\nhooks.useGetUserQuery();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: '/p/hooks.ts' },
      ]);
    });

    it('keeps a member of an unresolvable namespace by its own name', () => {
      const index = indexOf({
        '/p/App.tsx':
          "import * as api from '@acme/api';\napi.useGetUserQuery();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
    });

    it('treats a member of an ordinary object as an unbound name', () => {
      const index = indexOf({
        '/p/App.tsx':
          "import { api } from './client';\napi.useGetUserQuery();\nstore.api.useOtherQuery();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/App.tsx', origin: 'unbound' },
      ]);
      expect(canonicalOf(index, 'useOtherQuery')).toEqual([
        { file: '/p/App.tsx', origin: 'unbound' },
      ]);
    });

    it('keeps two files with the same non-exported constant apart', () => {
      const index = indexOf({
        '/p/a.ts': 'const query = 1;\nuse(query);',
        '/p/b.ts': 'const query = 2;\nuse(query);',
      });

      expect(canonicalOf(index, 'query')).toEqual([
        { file: '/p/a.ts', origin: '/p/a.ts' },
        { file: '/p/b.ts', origin: '/p/b.ts' },
      ]);
    });

    it('does not let a same-named local in another file shadow an import', () => {
      const index = indexOf({
        '/p/other.ts': 'const GetUserDocument = 1;\nexport {};',
        '/p/App.tsx':
          "import { GetUserDocument } from '../generated/graphql';\nuseQuery(GetUserDocument);",
      });

      expect(canonicalOf(index, 'GetUserDocument')).toEqual([
        { file: '/p/App.tsx', origin: 'outside' },
      ]);
    });

    it('resolves a destructured require like a named import', () => {
      const index = indexOf({
        '/p/hooks.cjs': 'exports.useGetUserQuery = () => 1;',
        '/p/app.cjs':
          "const { useGetUserQuery: useUser } = require('./hooks.cjs');\nuseUser();",
      });

      expect(canonicalOf(index, 'useGetUserQuery')).toEqual([
        { file: '/p/app.cjs', origin: '/p/hooks.cjs' },
      ]);
    });
  });

  describe('what the index records', () => {
    const index = indexOf({
      '/p/src/api/index.ts': "export * from './hooks';",
      '/p/src/api/hooks.ts':
        "export { useGetUserQuery } from '../generated/graphql';",
      '/p/src/App.tsx': [
        "import { useGetUserQuery } from './api';",
        "import { GetLegacyDocument } from './api';",
        'export function App() {',
        '  const first = useGetUserQuery();',
        '  const second = useGetUserQuery();',
        "  const names = ['GetOrphan'];",
        '  return first ?? second ?? names;',
        '}',
      ].join('\n'),
    });

    it('lists every reference to a canonical name with its position', () => {
      expect(
        index.byName
          .get('useGetUserQuery')
          ?.map((ref) => [ref.file, ref.line, ref.column]),
      ).toEqual([
        ['/p/src/App.tsx', 4, 17],
        ['/p/src/App.tsx', 5, 18],
      ]);
    });

    it('records nothing for an import that is never read', () => {
      expect(index.byName.has('GetLegacyDocument')).toBe(false);
    });

    it('records nothing for a barrel that only re-exports', () => {
      expect(index.byFile.get('/p/src/api/index.ts')).toEqual([]);
      expect(index.byFile.get('/p/src/api/hooks.ts')).toEqual([]);
    });

    it('finds the first reference for any of several names', () => {
      const found = index.firstReference([
        'GetUserDocument',
        'useGetUserQuery',
      ]);

      expect(found?.name).toBe('useGetUserQuery');
      expect(found?.line).toBe(4);
      expect(index.firstReference(['useNothingQuery'])).toBeUndefined();
    });

    it('lists the identifiers and string words per file', () => {
      expect(index.identifiersByFile.get('/p/src/App.tsx')).toEqual(
        new Set(['App', 'first', 'useGetUserQuery', 'second', 'names']),
      );
      expect(index.stringWordsByFile.get('/p/src/App.tsx')).toEqual(
        new Set(['GetOrphan']),
      );
    });

    it('lists the files in scan order and maps a path back to its file', () => {
      expect(index.files).toEqual([
        '/p/src/api/index.ts',
        '/p/src/api/hooks.ts',
        '/p/src/App.tsx',
      ]);
      expect(index.displayName('/p/src/App.tsx')).toBe('/p/src/App.tsx');
    });

    it('records the resolution chain for --verbose', () => {
      const [ref] = index.byName.get('useGetUserQuery') ?? [];

      expect(describeResolution(ref.canonical)).toEqual([
        "imported from './api' in /p/src/App.tsx",
        "re-exported from './hooks' in /p/src/api/index.ts",
        "re-exported from '../generated/graphql' in /p/src/api/hooks.ts, which is outside the scanned files",
      ]);
    });

    it('describes a bare identifier as bound nowhere', () => {
      const bare = indexOf({ '/p/a.ts': 'useGetUserQuery();' });
      const [ref] = bare.byName.get('useGetUserQuery') ?? [];

      expect(describeResolution(ref.canonical)).toEqual([]);
    });
  });

  describe('referencesTo', () => {
    it('finds references by binding identity, not by name', () => {
      const index = indexOf({
        '/p/docs.ts': 'export const userQuery = gql`query A { a }`;',
        '/p/other.ts': 'const userQuery = 1;\nuse(userQuery);',
        '/p/App.tsx':
          "import { userQuery } from './docs';\nuseQuery(userQuery);",
      });

      expect(
        index.referencesTo('/p/docs.ts', 'userQuery').map((ref) => ref.file),
      ).toEqual(['/p/App.tsx']);
      expect(
        index.referencesTo('/p/other.ts', 'userQuery').map((ref) => ref.file),
      ).toEqual(['/p/other.ts']);
      expect(index.referencesTo('/p/nowhere.ts', 'userQuery')).toEqual([]);
    });

    it('never counts the declaration itself', () => {
      const index = indexOf({
        '/p/docs.ts':
          'export const GetUserDocument = graphql(`query GetUser { id }`);',
      });

      expect(index.referencesTo('/p/docs.ts', 'GetUserDocument')).toEqual([]);
      expect(index.byName.has('GetUserDocument')).toBe(false);
    });
  });

  describe('string words and inline bodies', () => {
    const files = {
      '/p/docs.ts':
        "const q = gql`query GetUser { id }`;\nconst s = 'GetLegacy';",
    };

    it('counts the words of an inline document body when the inline pass is off', () => {
      expect(indexOf(files).stringWordsByFile.get('/p/docs.ts')).toEqual(
        new Set(['GetLegacy', 'query', 'GetUser', 'id']),
      );
    });

    it('leaves them out when the inline pass is on', () => {
      expect(
        indexOf(files, { inline: true }).stringWordsByFile.get('/p/docs.ts'),
      ).toEqual(new Set(['GetLegacy']));
    });
  });

  describe('resolution work', () => {
    it('asks the resolver once per binding however often it is referenced', () => {
      const resolve = jest.fn((specifier: string, from: string) =>
        createMapResolver({
          '/p/App.tsx': { './hooks': '/p/hooks.ts' },
        }).resolve(specifier, from),
      );
      const index = indexOf(
        {
          '/p/hooks.ts': 'export const useGetUserQuery = () => 1;',
          '/p/App.tsx':
            "import { useGetUserQuery } from './hooks';\nuseGetUserQuery();\nuseGetUserQuery();\nuseGetUserQuery();",
        },
        { resolver: { resolve } },
      );

      expect(index.byName.get('useGetUserQuery')).toHaveLength(3);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith('./hooks', '/p/App.tsx');
    });

    it('never matches a name welded into a longer identifier', () => {
      const index = indexOf({
        '/p/App.tsx':
          "import { GetWholeWordUserDocument } from './generated';\nuseQuery(GetWholeWordUserDocument);",
      });

      expect(index.byName.has('WholeWordUserDocument')).toBe(false);
      expect(index.firstReference(['WholeWordUserDocument'])).toBeUndefined();
    });
  });
});
