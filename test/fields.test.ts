// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as fs from 'fs';
import {
  findUnusedFieldCandidates,
  isResponseKeyInSources,
} from '../src/utils/fields';
import { extractGraphqlEntities } from '../src/utils/operations';
import { SourceFile } from '../src/utils/fileUtils';

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

  describe('findUnusedFieldCandidates', () => {
    it('flags a field whose response key appears nowhere in the source', () => {
      const parsed = parseFiles({
        'a.gql': 'query GetUser {\n  user {\n    avatarUrl\n  }\n}',
      });

      // `user` is read in source, `avatarUrl` is not.
      expect(
        findUnusedFieldCandidates(
          parsed,
          [],
          [],
          [source('const { user } = useGetUserQuery().data;')],
        ),
      ).toEqual([
        { field: 'avatarUrl', locations: [{ file: 'a.gql', line: 3 }] },
      ]);
    });

    it('does not flag a field whose key appears in the source', () => {
      const parsed = parseFiles({
        'a.gql': 'query GetUser {\n  user {\n    avatarUrl\n  }\n}',
      });

      expect(
        findUnusedFieldCandidates(
          parsed,
          [],
          [],
          [source('const { avatarUrl } = data.user;')],
        ),
      ).toEqual([]);
    });

    it('checks the alias rather than the field name when a field is aliased', () => {
      const parsed = parseFiles({
        'a.gql': 'query GetUser {\n  picture: avatarUrl\n}',
      });

      // The underlying name is read in source, the alias is not. The alias is
      // the response key the app actually sees, so it is what gets flagged.
      const candidates = findUnusedFieldCandidates(
        parsed,
        [],
        [],
        [source('const a = avatarUrl;')],
      );

      expect(candidates).toEqual([
        { field: 'picture', locations: [{ file: 'a.gql', line: 2 }] },
      ]);
    });

    it('never flags __typename', () => {
      const parsed = parseFiles({
        'a.gql': 'query GetUser {\n  __typename\n}',
      });

      expect(findUnusedFieldCandidates(parsed, [], [], [source('')])).toEqual(
        [],
      );
    });

    it('ignores fields of an unused operation', () => {
      const parsed = parseFiles({
        'a.gql': 'query Dead {\n  deadField\n}',
      });

      expect(
        findUnusedFieldCandidates(
          parsed,
          [{ name: 'Dead', type: 'query', filePath: 'a.gql' }],
          [],
          [source('')],
        ),
      ).toEqual([]);
    });

    it('treats an anonymous operation as used', () => {
      const parsed = parseFiles({ 'a.gql': 'query {\n  anonField\n}' });

      expect(findUnusedFieldCandidates(parsed, [], [], [source('')])).toEqual([
        { field: 'anonField', locations: [{ file: 'a.gql', line: 2 }] },
      ]);
    });

    it('ignores fields of a fragment only reachable from an unused operation', () => {
      const parsed = parseFiles({
        'ops.gql': 'query Dead {\n  ...DeadFields\n}',
        'frags.gql': 'fragment DeadFields on User {\n  deadField\n}',
      });

      expect(
        findUnusedFieldCandidates(
          parsed,
          [{ name: 'Dead', type: 'query', filePath: 'ops.gql' }],
          [],
          [source('')],
        ),
      ).toEqual([]);
    });

    it('reports fields of a fragment reachable from a used operation', () => {
      const parsed = parseFiles({
        'ops.gql': 'query Live {\n  ...LiveFields\n}',
        'frags.gql': 'fragment LiveFields on User {\n  liveField\n}',
      });

      expect(
        findUnusedFieldCandidates(parsed, [], [], [source('useLiveQuery()')]),
      ).toEqual([
        { field: 'liveField', locations: [{ file: 'frags.gql', line: 2 }] },
      ]);
    });

    it('follows transitive spreads from a used operation', () => {
      const parsed = parseFiles({
        'ops.gql': 'query Live {\n  ...Outer\n}',
        'frags.gql':
          'fragment Outer on User {\n  ...Inner\n}\nfragment Inner on User {\n  nestedField\n}',
      });

      expect(findUnusedFieldCandidates(parsed, [], [], [source('')])).toEqual([
        { field: 'nestedField', locations: [{ file: 'frags.gql', line: 5 }] },
      ]);
    });

    it('ignores fields of a fragment already reported unused', () => {
      const parsed = parseFiles({
        'ops.gql': 'query Live {\n  ...DeadFields\n}',
        'frags.gql': 'fragment DeadFields on User {\n  deadField\n}',
      });

      expect(
        findUnusedFieldCandidates(
          parsed,
          [],
          [{ name: 'DeadFields', filePath: 'frags.gql' }],
          [source('')],
        ),
      ).toEqual([]);
    });

    it('skips a file that failed to parse', () => {
      const parsed = parseFiles({
        'broken.gql': 'query Broken {',
        'a.gql': 'query GetUser {\n  avatarUrl\n}',
      });

      expect(findUnusedFieldCandidates(parsed, [], [], [source('')])).toEqual([
        { field: 'avatarUrl', locations: [{ file: 'a.gql', line: 2 }] },
      ]);
    });

    it('aggregates every selection of the same key onto one finding', () => {
      const parsed = parseFiles({
        'a.gql': 'query One {\n  user {\n    avatarUrl\n  }\n}',
        'b.gql': 'query Two {\n  avatarUrl\n}',
      });

      expect(
        findUnusedFieldCandidates(
          parsed,
          [],
          [],
          [source('const { user } = data;')],
        ),
      ).toEqual([
        {
          field: 'avatarUrl',
          locations: [
            { file: 'a.gql', line: 3 },
            { file: 'b.gql', line: 2 },
          ],
        },
      ]);
    });

    it('collects nested selections and keeps first-seen order', () => {
      const parsed = parseFiles({
        'a.gql': 'query One {\n  outerField {\n    innerField\n  }\n}',
      });

      expect(
        findUnusedFieldCandidates(parsed, [], [], [source('')]).map(
          (candidate) => candidate.field,
        ),
      ).toEqual(['outerField', 'innerField']);
    });

    it('returns [] when there is nothing to scan', () => {
      expect(findUnusedFieldCandidates([], [], [], [])).toEqual([]);
    });
  });
});
