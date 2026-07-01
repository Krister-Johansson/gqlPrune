import * as fs from 'fs';
import {
  createExcludeMatcher,
  directoryExists,
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

describe('fileUtils', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('findFilesWithExtension', () => {
    afterEach(() => {
      jest.resetAllMocks();
    });

    it('should find files with the given extensions', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'file1.ts',
        'file2.js',
        'folder1',
      ]);
      (fs.statSync as jest.Mock)
        .mockReturnValueOnce({ isDirectory: () => false })
        .mockReturnValueOnce({ isDirectory: () => false })
        .mockReturnValueOnce({ isDirectory: () => true });

      const files = findFilesWithExtension('./', ['.ts'], () => false);
      expect(files).toEqual(['file1.ts']); // Adjusted the expected value
    });

    it('should handle error when reading a directory', () => {
      (fs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to read directory');
      });

      const files = findFilesWithExtension('./', ['.ts'], () => false);
      expect(files).toEqual([]); // Expect an empty array since the directory read failed
    });

    it('should handle error when reading stats for a file', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['file1.ts']);
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to read file stats');
      });

      const files = findFilesWithExtension('./', ['.ts'], () => false);
      expect(files).toEqual([]); // Expect an empty array since the file stats read failed
    });

    it('should handle error when reading stats for a folder', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['folder1']);
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to read folder stats');
      });

      const files = findFilesWithExtension('./', ['.ts'], () => false);
      expect(files).toEqual([]); // Expect an empty array since the folder stats read failed
    });

    it('skips excluded directories and files via the matcher', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'keep.ts',
        'node_modules',
        'skip.gen.ts',
      ]);
      (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
        isDirectory: () => p.endsWith('node_modules'),
      }));
      const matcher = createExcludeMatcher(['node_modules', '*.gen.ts']);
      expect(findFilesWithExtension('./', ['.ts'], matcher)).toEqual([
        'keep.ts',
      ]);
    });

    it('honors file-level "!" re-includes during the walk', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue([
        'foo.gen.ts',
        'keep.gen.ts',
        'app.ts',
      ]);
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => false });
      const matcher = createExcludeMatcher(['*.gen.ts', '!keep.gen.ts']);
      expect(findFilesWithExtension('./', ['.ts'], matcher).sort()).toEqual([
        'app.ts',
        'keep.gen.ts',
      ]);
    });

    it('cannot re-include under an excluded directory (gitignore limitation)', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['gen', 'app.ts']);
      (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
        isDirectory: () => p.endsWith('gen'),
      }));
      // `gen` is pruned before traversal, so `!gen/keep.ts` can't reach inside.
      const matcher = createExcludeMatcher(['gen', '!gen/keep.ts']);
      expect(findFilesWithExtension('./', ['.ts'], matcher)).toEqual([
        'app.ts',
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
