// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as path from 'path';
import { findOrphanedFiles } from '../src/utils/orphans';
import { GraphqlFileEntities } from '../src/utils/operations';
import { OperationInfo } from '../src/types/OperationInfo';
import { FragmentInfo } from '../src/types/FragmentInfo';

const op = (name: string, filePath: string): OperationInfo => ({
  name,
  type: 'query',
  filePath,
});

const frag = (name: string, filePath: string): FragmentInfo => ({
  name,
  filePath,
});

/** A parsed file, defaulting every field a test does not care about. */
const parsed = (
  filePath: string,
  entities: Partial<GraphqlFileEntities> = {},
): GraphqlFileEntities => ({
  filePath,
  operations: [],
  fragments: [],
  operationSpreads: [],
  fragmentSpreads: [],
  imports: [],
  hasAnonymousOperation: false,
  ...entities,
});

describe('orphans', () => {
  describe('findOrphanedFiles', () => {
    it('flags a file whose every operation is unused and which nothing imports', () => {
      const files = [
        parsed('g/dead.gql', {
          operations: [op('A', 'g/dead.gql'), op('B', 'g/dead.gql')],
        }),
      ];
      expect(
        findOrphanedFiles(
          files,
          [op('A', 'g/dead.gql'), op('B', 'g/dead.gql')],
          [],
        ),
      ).toEqual(['g/dead.gql']);
    });

    it('flags a fragment-only file whose fragment is unused', () => {
      const files = [
        parsed('g/frags.gql', { fragments: [frag('F', 'g/frags.gql')] }),
      ];
      expect(findOrphanedFiles(files, [], [frag('F', 'g/frags.gql')])).toEqual([
        'g/frags.gql',
      ]);
    });

    it('does not flag a file with one still-used operation', () => {
      const files = [
        parsed('g/mixed.gql', {
          operations: [op('Used', 'g/mixed.gql'), op('Dead', 'g/mixed.gql')],
        }),
      ];
      expect(findOrphanedFiles(files, [op('Dead', 'g/mixed.gql')], [])).toEqual(
        [],
      );
    });

    it('does not flag a file whose operations are unused but a fragment is used', () => {
      const files = [
        parsed('g/mixed.gql', {
          operations: [op('Dead', 'g/mixed.gql')],
          fragments: [frag('Live', 'g/mixed.gql')],
        }),
      ];
      expect(findOrphanedFiles(files, [op('Dead', 'g/mixed.gql')], [])).toEqual(
        [],
      );
    });

    it('does not flag a file another document #imports', () => {
      const files = [
        parsed('g/frags.gql', { fragments: [frag('F', 'g/frags.gql')] }),
        parsed('g/user.gql', {
          operations: [op('Live', 'g/user.gql')],
          imports: [path.resolve('g/frags.gql')],
        }),
      ];
      expect(findOrphanedFiles(files, [], [frag('F', 'g/frags.gql')])).toEqual(
        [],
      );
    });

    it('matches an import against the importee regardless of path spelling', () => {
      const files = [
        parsed('./g/frags.gql', { fragments: [frag('F', './g/frags.gql')] }),
        parsed('g/user.gql', {
          imports: [path.resolve('g', './frags.gql')],
        }),
      ];
      expect(
        findOrphanedFiles(files, [], [frag('F', './g/frags.gql')]),
      ).toEqual([]);
    });

    it('still flags a file that only imports itself', () => {
      const files = [
        parsed('g/dead.gql', {
          operations: [op('A', 'g/dead.gql')],
          imports: [path.resolve('g/dead.gql')],
        }),
      ];
      expect(findOrphanedFiles(files, [op('A', 'g/dead.gql')], [])).toEqual([
        'g/dead.gql',
      ]);
    });

    it('does not flag a file that defines nothing (empty or unparsable)', () => {
      expect(findOrphanedFiles([parsed('g/empty.gql')], [], [])).toEqual([]);
    });

    it('does not flag a file containing an anonymous operation', () => {
      const files = [
        parsed('g/anon.gql', {
          fragments: [frag('F', 'g/anon.gql')],
          hasAnonymousOperation: true,
        }),
      ];
      expect(findOrphanedFiles(files, [], [frag('F', 'g/anon.gql')])).toEqual(
        [],
      );
    });

    it('keys unused definitions by file as well as name', () => {
      // "Shared" is unused in other.gql but used in dead.gql, so dead.gql lives.
      const files = [
        parsed('g/dead.gql', { operations: [op('Shared', 'g/dead.gql')] }),
      ];
      expect(
        findOrphanedFiles(files, [op('Shared', 'g/other.gql')], []),
      ).toEqual([]);
    });

    it('keys unused definitions by kind as well as file and name', () => {
      // Operations and fragments are separate namespaces: the unused query
      // "Shared" must not make the still-used fragment "Shared" look dead.
      const files = [
        parsed('g/both.gql', {
          operations: [op('Shared', 'g/both.gql')],
          fragments: [frag('Shared', 'g/both.gql')],
        }),
      ];
      expect(
        findOrphanedFiles(files, [op('Shared', 'g/both.gql')], []),
      ).toEqual([]);
    });

    it('does not let an unused fragment stand in for a used operation', () => {
      const files = [
        parsed('g/both.gql', {
          operations: [op('Shared', 'g/both.gql')],
          fragments: [frag('Shared', 'g/both.gql')],
        }),
      ];
      expect(
        findOrphanedFiles(files, [], [frag('Shared', 'g/both.gql')]),
      ).toEqual([]);
    });

    it('returns the flagged files in scan order', () => {
      const files = [
        parsed('g/a.gql', { operations: [op('A', 'g/a.gql')] }),
        parsed('g/b.gql', { operations: [op('B', 'g/b.gql')] }),
      ];
      expect(
        findOrphanedFiles(files, [op('A', 'g/a.gql'), op('B', 'g/b.gql')], []),
      ).toEqual(['g/a.gql', 'g/b.gql']);
    });

    it('returns [] when nothing is unused', () => {
      const files = [parsed('g/a.gql', { operations: [op('A', 'g/a.gql')] })];
      expect(findOrphanedFiles(files, [], [])).toEqual([]);
    });
  });
});
