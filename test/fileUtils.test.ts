import * as fs from 'fs';
import {
  directoryExists,
  findFilesWithExtension,
  isOperationUsed,
} from '../src/utils/fileUtils';

jest.mock('fs');

// Suppress console.error logs for the entire test suite
let originalConsoleError: any;

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
});
