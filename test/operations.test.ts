import * as fs from 'fs';
import { parse } from 'graphql';
import {
  extractGraphqlEntities,
  getFragmentSpreads,
} from '../src/utils/operations';

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

describe('operationUtils', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('getFragmentSpreads', () => {
    it('collects spreads including nested and inline fragments', () => {
      const op = parse('query Q { a { ...F } ... on T { ...G } ...H }')
        .definitions[0];
      expect(getFragmentSpreads(op).sort()).toEqual(['F', 'G', 'H']);
    });

    it('returns an empty array when there are no spreads', () => {
      const fragment = parse('fragment X on T { id }').definitions[0];
      expect(getFragmentSpreads(fragment)).toEqual([]);
    });
  });

  describe('extractGraphqlEntities', () => {
    it('extracts operations, fragments, and spread edges', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'query GetUser { ...UserFields }\n' +
          'fragment UserFields on User { id ...Inner }\n' +
          'fragment Inner on User { name }',
      );
      const r = extractGraphqlEntities('f.gql');
      expect(r.operations).toEqual([
        { name: 'GetUser', type: 'query', filePath: 'f.gql', line: 1 },
      ]);
      expect(r.fragments).toEqual([
        { name: 'UserFields', filePath: 'f.gql', line: 2 },
        { name: 'Inner', filePath: 'f.gql', line: 3 },
      ]);
      expect(r.operationSpreads).toEqual(['UserFields']);
      expect(r.fragmentSpreads).toEqual(
        expect.arrayContaining([
          { name: 'UserFields', spreads: ['Inner'] },
          { name: 'Inner', spreads: [] },
        ]),
      );
    });

    it('collects spreads from anonymous operations too', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'query { ...Anon }\nfragment Anon on T { id }',
      );
      const r = extractGraphqlEntities('f.gql');
      expect(r.operations).toEqual([]); // anonymous op is not a named operation
      expect(r.operationSpreads).toEqual(['Anon']); // but its spread still counts
    });

    it('returns an empty structure on parse error', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('query Broken {');
      expect(extractGraphqlEntities('f.gql')).toEqual({
        operations: [],
        fragments: [],
        operationSpreads: [],
        fragmentSpreads: [],
      });
    });
  });
});
