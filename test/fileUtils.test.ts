import * as fs from 'fs';
import {
  directoryExists,
  findFilesWithExtension,
  isExcludedFolder,
  isOperationUsed,
  isOperationUsedInContents,
  readFileContents,
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

      const files = findFilesWithExtension('./', ['.ts'], []);
      expect(files).toEqual(['file1.ts']); // Adjusted the expected value
    });

    it('should handle error when reading a directory', () => {
      (fs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to read directory');
      });

      const files = findFilesWithExtension('./', ['.ts'], []);
      expect(files).toEqual([]); // Expect an empty array since the directory read failed
    });

    it('should handle error when reading stats for a file', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['file1.ts']);
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to read file stats');
      });

      const files = findFilesWithExtension('./', ['.ts'], []);
      expect(files).toEqual([]); // Expect an empty array since the file stats read failed
    });

    it('should handle error when reading stats for a folder', () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['folder1']);
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to read folder stats');
      });

      const files = findFilesWithExtension('./', ['.ts'], []);
      expect(files).toEqual([]); // Expect an empty array since the folder stats read failed
    });
  });

  describe('isOperationUsed', () => {
    it('should check if an operation is used in a file', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'const result = useMyQuery();',
      );
      expect(isOperationUsed('useMyQuery', './file.ts')).toBe(true);
      expect(isOperationUsed('useAnotherQuery', './file.ts')).toBe(false);
    });

    it('should handle error when reading a file', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to read file');
      });

      const result = isOperationUsed('someOperation', './file1.ts');
      expect(result).toBe(false); // Expect false since the file read failed
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

  describe('isExcludedFolder', () => {
    it('should exclude by folder basename anywhere in the tree', () => {
      expect(isExcludedFolder('node_modules', ['node_modules'])).toBe(true);
      expect(isExcludedFolder('src/api/__generated__', ['__generated__'])).toBe(
        true,
      );
    });

    it('should accept entries with a leading "./"', () => {
      expect(isExcludedFolder('node_modules', ['./node_modules'])).toBe(true);
    });

    it('should exclude by path relative to the project root', () => {
      expect(isExcludedFolder('src/generated', ['src/generated'])).toBe(true);
    });

    it('should not exclude unrelated folders', () => {
      expect(isExcludedFolder('src', ['node_modules'])).toBe(false);
      expect(isExcludedFolder('src/components', [])).toBe(false);
    });
  });

  describe('readFileContents', () => {
    it('should read each file once and return their contents', () => {
      (fs.readFileSync as jest.Mock)
        .mockReturnValueOnce('content-a')
        .mockReturnValueOnce('content-b');

      expect(readFileContents(['a.ts', 'b.ts'])).toEqual([
        'content-a',
        'content-b',
      ]);
      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
    });

    it('should skip files that cannot be read', () => {
      (fs.readFileSync as jest.Mock)
        .mockImplementationOnce(() => {
          throw new Error('nope');
        })
        .mockReturnValueOnce('content-b');

      expect(readFileContents(['bad.ts', 'b.ts'])).toEqual(['content-b']);
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
