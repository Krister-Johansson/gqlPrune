import * as fs from 'fs';
import { extractOperations } from '../src/utils/operations';

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

describe('operationUtils', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('extractOperations', () => {
    it('should extract operations from a valid GraphQL file', () => {
      const mockContent = `
        query MyQuery {
          someField
        }
      `;
      (fs.readFileSync as jest.Mock).mockReturnValue(mockContent);

      const operations = extractOperations('./mockFile.gql');
      expect(operations).toEqual([
        {
          name: 'MyQuery',
          type: 'query',
          filePath: './mockFile.gql',
        },
      ]);
    });

    it('should handle invalid GraphQL content', () => {
      const mockContent = `
        query MyQuery {
          someField
      `;
      (fs.readFileSync as jest.Mock).mockReturnValue(mockContent);

      const operations = extractOperations('./mockFile.gql');
      expect(operations).toEqual([]);
    });

    it('should handle error when reading a file', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to read file');
      });

      const operations = extractOperations('./mockFile.gql');
      expect(operations).toEqual([]);
    });
  });
});
