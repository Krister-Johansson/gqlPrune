// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as fs from 'fs';
import {
  createExcludeMatcher,
  directoryExists,
  expandDirPatterns,
  findFilesWithExtension,
  isOperationUsedInContents,
  readSourceFiles,
} from '../src/utils/fileUtils';
import { buildUsagePatterns } from '../src/utils/usagePatterns';

jest.mock('fs');

// Suppress console.error logs for the entire test suite
let originalConsoleError: typeof console.error;

beforeAll(() => {
  originalConsoleError = console.error;
  console.error = jest.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
});

// A minimal fs.Dirent stand-in, as returned by readdirSync withFileTypes.
const dirent = (
  name: string,
  opts: { dir?: boolean; link?: boolean } = {},
) => ({
  name,
  isDirectory: () => opts.dir === true,
  isSymbolicLink: () => opts.link === true,
});

describe('fileUtils', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('findFilesWithExtension', () => {
    afterEach(() => {
      jest.resetAllMocks();
    });

    // Unless a test says otherwise, every path is its own real path.
    beforeEach(() => {
      (fs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => p,
      );
    });

    it('should find files with the given extensions', () => {
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) =>
        p === './'
          ? [
              dirent('file1.ts'),
              dirent('file2.js'),
              dirent('folder1', { dir: true }),
            ]
          : [],
      );

      const files = findFilesWithExtension('./', ['.ts'], () => false);
      expect(files).toEqual(['file1.ts']);
    });

    it('should handle error when reading a directory', () => {
      (fs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to read directory');
      });

      const files = findFilesWithExtension('./', ['.ts'], () => false);
      expect(files).toEqual([]); // Expect an empty array since the directory read failed
    });

    it('follows a symlink to a directory outside the walked tree', () => {
      (fs.readdirSync as jest.Mock).mockImplementation(
        (p: string) =>
          p === './' ? [dirent('alias', { link: true })] : [dirent('a.ts')], // contents behind the link
      );
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
      (fs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => (p === 'alias' ? '/real/target' : p),
      );

      expect(findFilesWithExtension('./', ['.ts'], () => false)).toEqual([
        'alias/a.ts',
      ]);
    });

    it('follows a symlink directly to a matching file', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue([
        dirent('linked.ts', { link: true }),
      ]);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });

      expect(findFilesWithExtension('./', ['.ts'], () => false)).toEqual([
        'linked.ts',
      ]);
    });

    it('skips a broken symlink and keeps walking', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue([
        dirent('broken.ts', { link: true }),
        dirent('good.ts'),
      ]);
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT: dangling link');
      });

      expect(findFilesWithExtension('./', ['.ts'], () => false)).toEqual([
        'good.ts',
      ]);
    });

    it('terminates on a symlink cycle instead of recursing forever', () => {
      // `loop` points back at the directory being walked.
      (fs.readdirSync as jest.Mock).mockReturnValue([
        dirent('loop', { link: true }),
        dirent('a.ts'),
      ]);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
      (fs.realpathSync as unknown as jest.Mock).mockReturnValue(
        '/the/same/dir',
      );

      expect(findFilesWithExtension('./', ['.ts'], () => false)).toEqual([
        'a.ts',
      ]);
      // The cycle is pruned before re-reading: one readdir for the root only.
      expect(fs.readdirSync).toHaveBeenCalledTimes(1);
    });

    it('does not scan the same real directory twice via an alias symlink', () => {
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) =>
        p === './'
          ? [dirent('real', { dir: true }), dirent('alias', { link: true })]
          : p === 'real'
            ? [dirent('a.ts')]
            : [dirent('a.ts')],
      );
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
      (fs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => (p === 'real' || p === 'alias' ? '/canonical' : p),
      );

      // a.ts is reported once (under the path walked first), not twice.
      expect(findFilesWithExtension('./', ['.ts'], () => false)).toEqual([
        'real/a.ts',
      ]);
    });

    it('skips excluded directories and files via the matcher', () => {
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) =>
        p === './'
          ? [
              dirent('keep.ts'),
              dirent('node_modules', { dir: true }),
              dirent('skip.gen.ts'),
            ]
          : [],
      );
      const matcher = createExcludeMatcher(['node_modules', '*.gen.ts']);
      expect(findFilesWithExtension('./', ['.ts'], matcher)).toEqual([
        'keep.ts',
      ]);
    });

    it('honors file-level "!" re-includes during the walk', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue([
        dirent('foo.gen.ts'),
        dirent('keep.gen.ts'),
        dirent('app.ts'),
      ]);
      const matcher = createExcludeMatcher(['*.gen.ts', '!keep.gen.ts']);
      expect(findFilesWithExtension('./', ['.ts'], matcher).sort()).toEqual([
        'app.ts',
        'keep.gen.ts',
      ]);
    });

    it('cannot re-include under an excluded directory (gitignore limitation)', () => {
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) =>
        p === './' ? [dirent('gen', { dir: true }), dirent('app.ts')] : [],
      );
      // `gen` is pruned before traversal, so `!gen/keep.ts` can't reach inside.
      const matcher = createExcludeMatcher(['gen', '!gen/keep.ts']);
      expect(findFilesWithExtension('./', ['.ts'], matcher)).toEqual([
        'app.ts',
      ]);
    });
  });

  describe('expandDirPatterns', () => {
    afterEach(() => {
      jest.resetAllMocks();
    });

    // Builds a fake directory tree: each key is a directory path, each value the
    // names of its children. A name carrying a file extension (`graphql.ts`) is
    // a file; everything else, dotfolders included, is a directory.
    const mockTree = (tree: Record<string, string[]>) => {
      (fs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => p,
      );
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) =>
        (tree[p] ?? []).map((name) =>
          dirent(name, { dir: !/[^.]\.[a-z]+$/.test(name) }),
        ),
      );
    };

    it('passes a pattern without glob magic through untouched', () => {
      mockTree({});
      expect(expandDirPatterns(['./graphql', 'src/api'])).toEqual({
        dirs: ['./graphql', 'src/api'],
        unmatched: [],
      });
      // A literal path needs no walk: the missing-directory check handles it.
      expect(fs.readdirSync).not.toHaveBeenCalled();
    });

    it('passes a non-existent literal path through rather than reporting it', () => {
      mockTree({});
      expect(expandDirPatterns(['./nope'])).toEqual({
        dirs: ['./nope'],
        unmatched: [],
      });
    });

    it('expands a glob to every matching directory', () => {
      mockTree({
        packages: ['web', 'admin'],
        'packages/web': ['graphql', 'src'],
        'packages/admin': ['graphql'],
      });
      expect(expandDirPatterns(['packages/*/graphql'])).toEqual({
        dirs: ['packages/web/graphql', 'packages/admin/graphql'],
        unmatched: [],
      });
    });

    it('matches at any depth with **', () => {
      mockTree({
        apps: ['graphql', 'a'],
        'apps/a': ['nested'],
        'apps/a/nested': ['graphql'],
      });
      expect(expandDirPatterns(['apps/**/graphql']).dirs).toEqual([
        'apps/graphql',
        'apps/a/nested/graphql',
      ]);
    });

    it('walks from the project root when the pattern has no static base', () => {
      mockTree({ '.': ['web', 'admin'], web: ['graphql'], admin: ['graphql'] });
      expect(expandDirPatterns(['*/graphql']).dirs).toEqual([
        'web/graphql',
        'admin/graphql',
      ]);
    });

    it('normalizes a "./" prefix and keeps it on the expanded paths', () => {
      mockTree({ packages: ['web'], 'packages/web': ['graphql'] });
      expect(expandDirPatterns(['./packages/*/graphql']).dirs).toEqual([
        './packages/web/graphql',
      ]);
      expect(expandDirPatterns(['packages/*/graphql']).dirs).toEqual([
        'packages/web/graphql',
      ]);
    });

    it('matches directories only, never files', () => {
      mockTree({
        packages: ['web'],
        'packages/web': ['graphql', 'graphql.ts'],
      });
      expect(expandDirPatterns(['packages/*/*']).dirs).toEqual([
        'packages/web/graphql',
      ]);
    });

    it('never descends into node_modules or .git', () => {
      mockTree({
        '.': ['node_modules', '.git', 'packages'],
        node_modules: ['dep'],
        'node_modules/dep': ['graphql'],
        '.git': ['graphql'],
        packages: ['web'],
        'packages/web': ['graphql'],
      });
      expect(expandDirPatterns(['**/graphql']).dirs).toEqual([
        'packages/web/graphql',
      ]);
      expect(fs.readdirSync).not.toHaveBeenCalledWith(
        'node_modules',
        expect.anything(),
      );
    });

    it('de-duplicates matches while keeping walk order', () => {
      mockTree({ packages: ['web'], 'packages/web': ['graphql'] });
      expect(
        expandDirPatterns([
          'packages/*/graphql',
          'packages/**/graphql',
          './src',
          './src',
        ]),
      ).toEqual({
        dirs: ['packages/web/graphql', './src'],
        unmatched: [],
      });
    });

    it('reports a glob that matches no directory', () => {
      mockTree({ packages: ['web'], 'packages/web': ['src'] });
      expect(expandDirPatterns(['packages/*/graphql', './src'])).toEqual({
        dirs: ['./src'],
        unmatched: ['packages/*/graphql'],
      });
    });

    it('reports a glob whose static base cannot be read', () => {
      (fs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => p,
      );
      (fs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(expandDirPatterns(['missing/*/graphql']).unmatched).toEqual([
        'missing/*/graphql',
      ]);
    });

    it('does not walk deeper than a glob without ** can match', () => {
      mockTree({
        packages: ['web'],
        'packages/web': ['graphql'],
        'packages/web/graphql': ['deep'],
      });
      expandDirPatterns(['packages/*/graphql']);
      expect(fs.readdirSync).not.toHaveBeenCalledWith(
        'packages/web/graphql',
        expect.anything(),
      );
    });

    it('follows a directory symlink and terminates on a cycle', () => {
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) =>
        p === 'packages'
          ? [dirent('web', { link: true })]
          : p === 'packages/web'
            ? [dirent('graphql', { dir: true }), dirent('loop', { link: true })]
            : [],
      );
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
      // `loop` points back at the directory it lives in.
      (fs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => (p === 'packages/web/loop' ? 'packages/web' : p),
      );

      expect(expandDirPatterns(['packages/**/graphql']).dirs).toEqual([
        'packages/web/graphql',
      ]);
    });

    it('skips a broken symlink and keeps walking', () => {
      (fs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => p,
      );
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) =>
        p === 'packages'
          ? [dirent('broken', { link: true }), dirent('web', { dir: true })]
          : [dirent('graphql', { dir: true })],
      );
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT: dangling link');
      });

      expect(expandDirPatterns(['packages/*/graphql']).dirs).toEqual([
        'packages/web/graphql',
      ]);
    });
  });

  describe('directoryExists', () => {
    afterEach(() => {
      jest.resetAllMocks();
    });

    it('should return true if directory exists', () => {
      (fs.statSync as jest.Mock).mockReturnValue({
        isDirectory: () => true,
      });

      const result = directoryExists('./existingDir');
      expect(result).toBe(true);
    });

    it('should return false if directory does not exist', () => {
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('Directory does not exist');
      });

      const result = directoryExists('./nonExistingDir');
      expect(result).toBe(false);
    });

    it('should return false if path is not a directory', () => {
      (fs.statSync as jest.Mock).mockReturnValue({
        isDirectory: () => false,
      });

      const result = directoryExists('./file.txt');
      expect(result).toBe(false);
    });
  });

  describe('createExcludeMatcher', () => {
    it('matches a bare name anywhere by basename', () => {
      const ex = createExcludeMatcher(['__generated__']);
      expect(ex('src/api/__generated__')).toBe(true);
      expect(ex('__generated__')).toBe(true);
      expect(ex('src/components')).toBe(false);
    });

    it('anchors a pattern that contains a slash to the project root', () => {
      const ex = createExcludeMatcher(['src/legacy']);
      expect(ex('src/legacy')).toBe(true);
      expect(ex('app/src/legacy')).toBe(false);
    });

    it('supports ** for any depth and basename globs for files', () => {
      const ex = createExcludeMatcher(['**/dist', '*.generated.ts']);
      expect(ex('a/b/dist')).toBe(true);
      expect(ex('src/x/foo.generated.ts')).toBe(true);
      expect(ex('src/x/foo.ts')).toBe(false);
    });

    it('matches dotfolders like .git', () => {
      expect(createExcludeMatcher(['.git'])('proj/.git')).toBe(true);
    });

    it('re-includes paths matched by a leading "!"', () => {
      const ex = createExcludeMatcher(['*.generated.ts', '!keep.generated.ts']);
      expect(ex('src/other.generated.ts')).toBe(true);
      expect(ex('src/keep.generated.ts')).toBe(false);
    });

    it('lets a negative win regardless of order or which field it came from', () => {
      // Order-insensitive: a `!` re-include always overrides a positive,
      // including a positive from the deprecated excludedFolders.
      expect(createExcludeMatcher(['keep.ts', '!keep.ts'])('src/keep.ts')).toBe(
        false,
      );
      expect(createExcludeMatcher(['!keep.ts', 'keep.ts'])('src/keep.ts')).toBe(
        false,
      );
    });

    it('excludes nothing when there are no positive patterns', () => {
      expect(createExcludeMatcher([])('anything')).toBe(false);
      expect(createExcludeMatcher(['  ', '!only-neg'])('anything')).toBe(false);
    });
  });

  describe('readSourceFiles', () => {
    it('pairs each readable file with its contents', () => {
      (fs.readFileSync as jest.Mock)
        .mockReturnValueOnce('content-a')
        .mockReturnValueOnce('content-b');

      expect(readSourceFiles(['a.ts', 'b.ts'])).toEqual([
        { file: 'a.ts', content: 'content-a' },
        { file: 'b.ts', content: 'content-b' },
      ]);
    });

    it('skips an unreadable file without misaligning the rest', () => {
      (fs.readFileSync as jest.Mock)
        .mockImplementationOnce(() => {
          throw new Error('nope');
        })
        .mockReturnValueOnce('content-b');

      expect(readSourceFiles(['bad.ts', 'b.ts'])).toEqual([
        { file: 'b.ts', content: 'content-b' },
      ]);
    });
  });

  describe('isOperationUsedInContents', () => {
    it('should detect a pattern across cached contents', () => {
      expect(
        isOperationUsedInContents(['useFoo'], ['nope', 'const x = useFoo()']),
      ).toBe(true);
      expect(isOperationUsedInContents(['useFoo'], ['nope', 'nada'])).toBe(
        false,
      );
    });

    it('should detect lazy, suspense and document usage (regression)', () => {
      const patterns = buildUsagePatterns({
        name: 'GetUser',
        type: 'query',
        filePath: 'GetUser.gql',
      });

      expect(isOperationUsedInContents(patterns, ['useGetUserQuery()'])).toBe(
        true,
      );
      expect(
        isOperationUsedInContents(patterns, ['useGetUserLazyQuery()']),
      ).toBe(true);
      expect(
        isOperationUsedInContents(patterns, ['useGetUserSuspenseQuery()']),
      ).toBe(true);
      expect(
        isOperationUsedInContents(patterns, ['useQuery(GetUserDocument)']),
      ).toBe(true);
      expect(isOperationUsedInContents(patterns, ['useGetThingQuery()'])).toBe(
        false,
      );
    });
  });
});
