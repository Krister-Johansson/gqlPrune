// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as fs from 'fs';
import {
  FieldTraceOptions,
  findUnusedFieldCandidates,
  isResponseKeyInSources,
} from '../src/utils/fields';
import {
  buildGraphqlEntities,
  extractGraphqlEntities,
} from '../src/utils/operations';
import { SourceFile } from '../src/utils/fileUtils';
import { parse, Source } from 'graphql';
import { DEFAULT_USAGE_PATTERNS } from '../src/utils/usagePatterns';
import { indexOf } from './support';

jest.mock('fs');

let originalConsoleError: typeof console.error;
beforeAll(() => {
  originalConsoleError = console.error;
  console.error = jest.fn();
});
afterAll(() => {
  console.error = originalConsoleError;
});

/**
 * Parses the given `path -> contents` map through the real extractor, so the
 * fixtures carry the same documents and spread edges a scan would produce.
 */
const parseFiles = (files: Record<string, string>) => {
  (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
    const content = files[filePath];
    if (content === undefined) throw new Error(`no such file: ${filePath}`);
    return content;
  });
  return Object.keys(files).map(extractGraphqlEntities);
};

const source = (content: string, file = 'src/App.tsx'): SourceFile => ({
  file,
  content,
});

describe('fields', () => {
  afterEach(() => jest.resetAllMocks());

  describe('isResponseKeyInSources', () => {
    it('matches a whole word inside a property access', () => {
      expect(isResponseKeyInSources('id', [source('const x = data.id;')])).toBe(
        true,
      );
    });

    it('does not match a substring of a longer word', () => {
      expect(isResponseKeyInSources('id', [source('const v = video;')])).toBe(
        false,
      );
    });

    it('is case-sensitive', () => {
      expect(
        isResponseKeyInSources('avatarUrl', [source('const a = avatarurl;')]),
      ).toBe(false);
    });

    it('returns false when there are no sources', () => {
      expect(isResponseKeyInSources('id', [])).toBe(false);
    });
  });

  describe('findUnusedFieldCandidates (name fallback)', () => {
    // Without trace options no call site can be found, so every operation
    // falls back to the whole-word search over its own keys.
    const candidatesOf = (
      parsed: ReturnType<typeof parseFiles>,
      sources: SourceFile[],
      unusedOperations: Parameters<typeof findUnusedFieldCandidates>[1] = [],
      unusedFragments: Parameters<typeof findUnusedFieldCandidates>[2] = [],
    ) =>
      findUnusedFieldCandidates(
        parsed,
        unusedOperations,
        unusedFragments,
        sources,
      ).candidates;

    it('flags a key of an operation whose name appears nowhere in the source', () => {
      const parsed = parseFiles({
        'a.gql': 'query GetUser {\n  user {\n    avatarUrl\n  }\n}',
      });

      // `user` is read in source, `avatarUrl` is not.
      expect(
        candidatesOf(parsed, [
          source('const { user } = useGetUserQuery().data;'),
        ]),
      ).toEqual([
        {
          operation: 'GetUser',
          path: 'user.avatarUrl',
          field: 'avatarUrl',
          locations: [{ file: 'a.gql', line: 3 }],
          traced: false,
        },
      ]);
    });

    it('does not flag a key that appears in the source', () => {
      const parsed = parseFiles({
        'a.gql': 'query GetUser {\n  user {\n    avatarUrl\n  }\n}',
      });

      expect(
        candidatesOf(parsed, [source('const { avatarUrl } = data.user;')]),
      ).toEqual([]);
    });

    it('checks the alias rather than the field name', () => {
      const parsed = parseFiles({
        'a.gql': 'query GetUser {\n  picture: avatarUrl\n}',
      });

      expect(
        candidatesOf(parsed, [source('const a = avatarUrl;')]).map(
          (candidate) => candidate.path,
        ),
      ).toEqual(['picture']);
    });

    it('never flags __typename', () => {
      const parsed = parseFiles({
        'a.gql': 'query GetUser {\n  __typename\n}',
      });

      expect(candidatesOf(parsed, [source('')])).toEqual([]);
    });

    it('ignores fields of an unused operation', () => {
      const parsed = parseFiles({ 'a.gql': 'query Dead {\n  deadField\n}' });

      expect(
        candidatesOf(
          parsed,
          [source('')],
          [{ name: 'Dead', type: 'query', filePath: 'a.gql' }],
        ),
      ).toEqual([]);
    });

    it('names an anonymous operation as such', () => {
      const parsed = parseFiles({ 'a.gql': 'query {\n  anonField\n}' });

      expect(
        candidatesOf(parsed, [source('')]).map(
          (candidate) => candidate.operation,
        ),
      ).toEqual(['(anonymous)']);
    });

    it('reports fields of a spread fragment under the operation that spreads it', () => {
      const parsed = parseFiles({
        'ops.gql': 'query Live {\n  ...Outer\n}',
        'frags.gql':
          'fragment Outer on User {\n  ...Inner\n}\nfragment Inner on User {\n  nestedField\n}',
      });

      expect(candidatesOf(parsed, [source('')])).toEqual([
        {
          operation: 'Live',
          path: 'nestedField',
          field: 'nestedField',
          locations: [{ file: 'frags.gql', line: 5 }],
          traced: false,
        },
      ]);
    });

    it('ignores fields of a fragment already reported unused', () => {
      const parsed = parseFiles({
        'ops.gql': 'query Live {\n  ...DeadFields\n}',
        'frags.gql': 'fragment DeadFields on User {\n  deadField\n}',
      });

      expect(
        candidatesOf(
          parsed,
          [source('')],
          [],
          [{ name: 'DeadFields', filePath: 'frags.gql' }],
        ),
      ).toEqual([]);
    });

    it('skips a file that failed to parse', () => {
      const parsed = parseFiles({
        'broken.gql': 'query Broken {',
        'a.gql': 'query GetUser {\n  avatarUrl\n}',
      });

      expect(
        candidatesOf(parsed, [source('')]).map((candidate) => candidate.path),
      ).toEqual(['avatarUrl']);
    });

    it('reports a key once per operation that selects it', () => {
      const parsed = parseFiles({
        'a.gql': 'query One {\n  user {\n    avatarUrl\n  }\n}',
        'b.gql': 'query Two {\n  avatarUrl\n}',
      });

      expect(
        candidatesOf(parsed, [source('const { user } = data;')]).map(
          (candidate) => `${candidate.operation}: ${candidate.path}`,
        ),
      ).toEqual(['One: user.avatarUrl', 'Two: avatarUrl']);
    });

    it('checks every key on its own, nested ones included', () => {
      const parsed = parseFiles({
        'a.gql': 'query One {\n  outerField {\n    innerField\n  }\n}',
      });

      expect(
        candidatesOf(parsed, [source('')]).map((candidate) => candidate.path),
      ).toEqual(['outerField', 'outerField.innerField']);
    });

    it('records each operation as matched by name, with nothing to trace', () => {
      const parsed = parseFiles({ 'a.gql': 'query One {\n  id\n}' });

      expect(
        findUnusedFieldCandidates(parsed, [], [], [source('id')]).traces,
      ).toEqual([
        {
          operation: 'One',
          type: 'query',
          file: 'a.gql',
          mode: 'fallback',
          fallback: 'no-reference',
          callSites: [],
        },
      ]);
    });

    it('returns nothing when there is nothing to scan', () => {
      expect(findUnusedFieldCandidates([], [], [], [])).toEqual({
        candidates: [],
        traces: [],
      });
    });
  });

  describe('findUnusedFieldCandidates (traced)', () => {
    /** Parses gql documents in memory; files are keyed by absolute path. */
    const documents = (files: Record<string, string>) =>
      Object.entries(files).map(([file, text]) =>
        buildGraphqlEntities(parse(new Source(text, file)), file),
      );

    const traceOptions = (
      files: Record<string, string>,
    ): FieldTraceOptions => ({
      index: indexOf(files),
      usagePatterns: DEFAULT_USAGE_PATTERNS,
      source: (path) =>
        files[path] === undefined
          ? undefined
          : { file: path, content: files[path] },
    });

    const analyse = (
      gql: Record<string, string>,
      files: Record<string, string>,
    ) =>
      findUnusedFieldCandidates(
        documents(gql),
        [],
        [],
        Object.entries(files).map(([file, content]) => ({ file, content })),
        traceOptions(files),
      );

    const USER = {
      '/g/user.gql':
        'query GetUser {\n  user {\n    id\n    avatarUrl\n    ...Extra\n  }\n}\nfragment Extra on User {\n  bio\n}',
    };

    it('reports what no traced read reaches, fragments merged in', () => {
      const result = analyse(USER, {
        '/p/App.tsx':
          'export function App() {\n  const { data } = useGetUserQuery();\n  return <p>{data.user.id}</p>;\n}',
      });

      expect(result.candidates).toEqual([
        {
          operation: 'GetUser',
          path: 'user.avatarUrl',
          field: 'avatarUrl',
          locations: [{ file: '/g/user.gql', line: 4 }],
          traced: true,
        },
        {
          operation: 'GetUser',
          path: 'user.bio',
          field: 'bio',
          locations: [{ file: '/g/user.gql', line: 9 }],
          traced: true,
        },
      ]);
      expect(result.traces).toEqual([
        {
          operation: 'GetUser',
          type: 'query',
          file: '/g/user.gql',
          mode: 'traced',
          callSites: [{ file: '/p/App.tsx', line: 2, column: 20 }],
        },
      ]);
    });

    it('unions the reads of every call site', () => {
      const result = analyse(USER, {
        '/p/A.tsx':
          'export function A() {\n  const { data } = useGetUserQuery();\n  return `${data.user.id}`;\n}',
        '/p/B.tsx':
          'export function B() {\n  const { data } = useQuery(GetUserDocument);\n  return `${data.user.bio}`;\n}',
      });

      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        'user.avatarUrl',
      ]);
      expect(result.traces[0].callSites).toHaveLength(2);
    });

    it('traces an inline document through the constant passed to a call', () => {
      const inline = buildGraphqlEntities(
        parse(
          new Source(
            'query GetFeed {\n  feed {\n    id\n    title\n  }\n}',
            '/p/App.tsx',
          ),
        ),
        '/p/App.tsx',
      );
      const files = {
        '/p/App.tsx':
          'const feedQuery = gql``;\nexport function App() {\n  const { data } = useQuery(feedQuery);\n  return `${data.feed.title}`;\n}',
      };

      const result = findUnusedFieldCandidates(
        [{ ...inline, identifier: 'feedQuery' }],
        [],
        [],
        [{ file: '/p/App.tsx', content: files['/p/App.tsx'] }],
        traceOptions(files),
      );

      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        'feed.id',
      ]);
      expect(result.traces[0].mode).toBe('traced');
    });

    it('falls back to the name search when a reference is not a call', () => {
      const result = analyse(USER, {
        '/p/App.tsx':
          'export function App() {\n  const { data } = useGetUserQuery();\n  return `${data.user.id}`;\n}\nconst refetchQueries = [GetUserDocument];\nconst bio = 1;',
      });

      expect(result.traces[0]).toEqual({
        operation: 'GetUser',
        type: 'query',
        file: '/g/user.gql',
        mode: 'fallback',
        fallback: 'untraceable-reference',
        reference: { file: '/p/App.tsx', line: 5, column: 25 },
        callSites: [],
      });
      // `id` and `bio` are words in the file, `avatarUrl` is not.
      expect(result.candidates).toEqual([
        {
          operation: 'GetUser',
          path: 'user.avatarUrl',
          field: 'avatarUrl',
          locations: [{ file: '/g/user.gql', line: 4 }],
          traced: false,
        },
      ]);
    });

    it('falls back for an operation nothing calls, beside one that is traced', () => {
      const result = analyse(
        {
          ...USER,
          '/g/feed.gql': 'query GetFeed {\n  feed {\n    title\n  }\n}',
        },
        {
          '/p/App.tsx':
            'export function App() {\n  const { data } = useGetUserQuery();\n  return `${data.user.id} ${data.user.bio}`;\n}',
        },
      );

      expect(
        result.candidates.map(
          (candidate) =>
            `${candidate.operation}: ${candidate.path} (${candidate.traced})`,
        ),
      ).toEqual([
        'GetUser: user.avatarUrl (true)',
        'GetFeed: feed (false)',
        'GetFeed: feed.title (false)',
      ]);
      expect(result.traces.map((trace) => trace.fallback)).toEqual([
        undefined,
        'no-reference',
      ]);
    });

    it('falls back for a mutation, whose selection may only feed the cache', () => {
      const result = analyse(
        {
          '/g/save.gql':
            'mutation SaveUser {\n  saveUser {\n    id\n    updatedAt\n  }\n}',
        },
        {
          '/p/App.tsx':
            'export function App() {\n  const [save] = useSaveUserMutation();\n  save();\n}\nconst id = 1;',
        },
      );

      expect(result.traces[0].fallback).toBe('mutation');
      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        'saveUser',
        'saveUser.updatedAt',
      ]);
    });

    it('treats a reference in a file the parser cannot take as untraceable', () => {
      const result = analyse(USER, {
        '/p/App.vue': '<script>useGetUserQuery()</script>',
      });

      expect(result.traces[0].fallback).toBe('untraceable-reference');
    });
  });
});
