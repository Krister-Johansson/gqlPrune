// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'graphql';
import {
  extractGraphqlEntities,
  extractImports,
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
      expect(r.hasAnonymousOperation).toBe(true);
    });

    it('reports no anonymous operation when every operation is named', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('query Named { id }');
      expect(extractGraphqlEntities('f.gql').hasAnonymousOperation).toBe(false);
    });

    it('carries the file path it parsed', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('query Q { id }');
      expect(extractGraphqlEntities('graphql/q.gql').filePath).toBe(
        'graphql/q.gql',
      );
    });

    it('returns an empty structure on parse error', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('query Broken {');
      expect(extractGraphqlEntities('f.gql')).toEqual({
        operations: [],
        fragments: [],
        operationSpreads: [],
        fragmentSpreads: [],
        filePath: 'f.gql',
        imports: [],
        hasAnonymousOperation: false,
      });
    });

    it('keeps the #import targets of a file that fails to parse', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        '#import "./fields.gql"\nquery Broken {',
      );
      expect(extractGraphqlEntities('graphql/q.gql').imports).toEqual([
        path.resolve('graphql', './fields.gql'),
      ]);
    });

    it('returns no imports when the file cannot be read', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(extractGraphqlEntities('f.gql').imports).toEqual([]);
    });
  });

  describe('extractImports', () => {
    it('resolves a double-quoted import against the file directory', () => {
      expect(
        extractImports('#import "./fields.gql"\n', 'graphql/user.gql'),
      ).toEqual([path.resolve('graphql', './fields.gql')]);
    });

    it('resolves a single-quoted import too', () => {
      expect(
        extractImports("#import '../shared/fields.graphql'\n", 'a/b/user.gql'),
      ).toEqual([path.resolve('a/b', '../shared/fields.graphql')]);
    });

    it('collects every import line, in order', () => {
      expect(
        extractImports('#import "./a.gql"\n#import "./b.gql"\n', 'g/u.gql'),
      ).toEqual([path.resolve('g', './a.gql'), path.resolve('g', './b.gql')]);
    });

    it('tolerates whitespace around the directive', () => {
      expect(extractImports('  #  import   "./a.gql"  \n', 'g/u.gql')).toEqual([
        path.resolve('g', './a.gql'),
      ]);
    });

    it('de-duplicates repeated imports of the same target', () => {
      expect(
        extractImports('#import "./a.gql"\n#import "./a.gql"\n', 'g/u.gql'),
      ).toEqual([path.resolve('g', './a.gql')]);
    });

    it('ignores comments that are not import directives', () => {
      expect(
        extractImports(
          '# import this fragment somewhere\n# imported by user.gql\n',
          'g/u.gql',
        ),
      ).toEqual([]);
    });

    it('ignores an import directive that is not at the start of a line', () => {
      expect(
        extractImports('query Q { id } #import "./a.gql"', 'g/u.gql'),
      ).toEqual([]);
    });

    it('returns an empty array when there are no imports', () => {
      expect(extractImports('query Q { id }', 'g/u.gql')).toEqual([]);
    });
  });
});
