import * as fs from 'fs';
import * as fileUtils from '../src/utils/fileUtils';
import { extractOperations } from '../src/utils/operations';
import * as fragments from '../src/utils/fragments';
import {
  buildJsonReport,
  DEFAULT_EXCLUDED_FOLDERS,
  findUnusedOperations,
  formatAnnotations,
  mainFunction,
  resolveExcludedFolders,
  resolveFragmentUsagePatterns,
  resolveUsagePatterns,
} from '../src/core/gqlPruner';
import {
  DEFAULT_FRAGMENT_USAGE_PATTERNS,
  DEFAULT_USAGE_PATTERNS,
} from '../src/utils/usagePatterns';
import { OperationInfo } from '../src/types/OperationInfo';

jest.mock('fs');
// Partial mock: keep the pure helpers (isOperationUsedInContents) real, stub the
// filesystem-backed ones so mainFunction's orchestration can be driven directly.
jest.mock('../src/utils/fileUtils', () => {
  const actual = jest.requireActual('../src/utils/fileUtils');
  return {
    ...actual,
    directoryExists: jest.fn(),
    findFilesWithExtension: jest.fn(),
    readFileContents: jest.fn(),
  };
});
jest.mock('../src/utils/operations', () => ({
  extractOperations: jest.fn(),
}));
jest.mock('../src/utils/fragments', () => ({
  findUnusedFragmentsInCorpus: jest.fn(() => []),
}));

const mockedDirExists = fileUtils.directoryExists as jest.Mock;
const mockedFind = fileUtils.findFilesWithExtension as jest.Mock;
const mockedRead = fileUtils.readFileContents as jest.Mock;
const mockedExtract = extractOperations as jest.Mock;
const mockedUnusedFragments =
  fragments.findUnusedFragmentsInCorpus as jest.Mock;

describe('gqlPruner', () => {
  describe('resolveExcludedFolders', () => {
    it('always includes node_modules and .git', () => {
      expect(resolveExcludedFolders({ graphqlDir: 'g', srcDir: 's' })).toEqual(
        DEFAULT_EXCLUDED_FOLDERS,
      );
    });

    it('accepts a single string', () => {
      expect(
        resolveExcludedFolders({
          graphqlDir: 'g',
          srcDir: 's',
          excludedFolders: 'legacy',
        }),
      ).toEqual(['legacy', 'node_modules', '.git']);
    });

    it('accepts an array and de-dupes the defaults', () => {
      expect(
        resolveExcludedFolders({
          graphqlDir: 'g',
          srcDir: 's',
          excludedFolders: ['a', 'node_modules'],
        }),
      ).toEqual(['a', 'node_modules', '.git']);
    });
  });

  describe('resolveUsagePatterns', () => {
    it('defaults when not provided', () => {
      expect(resolveUsagePatterns({ graphqlDir: 'g', srcDir: 's' })).toEqual(
        DEFAULT_USAGE_PATTERNS,
      );
    });

    it('defaults when given an empty array', () => {
      expect(
        resolveUsagePatterns({
          graphqlDir: 'g',
          srcDir: 's',
          usagePatterns: [],
        }),
      ).toEqual(DEFAULT_USAGE_PATTERNS);
    });

    it('uses configured patterns when provided', () => {
      expect(
        resolveUsagePatterns({
          graphqlDir: 'g',
          srcDir: 's',
          usagePatterns: ['{Name}'],
        }),
      ).toEqual(['{Name}']);
    });
  });

  describe('resolveFragmentUsagePatterns', () => {
    it('defaults when not provided', () => {
      expect(
        resolveFragmentUsagePatterns({ graphqlDir: 'g', srcDir: 's' }),
      ).toEqual(DEFAULT_FRAGMENT_USAGE_PATTERNS);
    });

    it('uses configured patterns when provided', () => {
      expect(
        resolveFragmentUsagePatterns({
          graphqlDir: 'g',
          srcDir: 's',
          fragmentUsagePatterns: ['{Name}FragmentDoc', '{Name}'],
        }),
      ).toEqual(['{Name}FragmentDoc', '{Name}']);
    });

    it('respects an explicit empty array (disables source detection)', () => {
      expect(
        resolveFragmentUsagePatterns({
          graphqlDir: 'g',
          srcDir: 's',
          fragmentUsagePatterns: [],
        }),
      ).toEqual([]);
    });
  });

  describe('findUnusedOperations', () => {
    const ops: OperationInfo[] = [
      { name: 'GetUser', type: 'query', filePath: 'a.gql' },
      { name: 'Unused', type: 'query', filePath: 'a.gql' },
    ];

    it('returns only operations not referenced in any content', () => {
      expect(
        findUnusedOperations(
          ops,
          ['const r = useGetUserQuery()'],
          DEFAULT_USAGE_PATTERNS,
        ),
      ).toEqual([{ name: 'Unused', type: 'query', filePath: 'a.gql' }]);
    });

    it('returns all when nothing references them', () => {
      expect(
        findUnusedOperations(ops, ['nothing here'], DEFAULT_USAGE_PATTERNS),
      ).toEqual(ops);
    });

    it('returns none when all are used', () => {
      expect(
        findUnusedOperations(
          ops,
          ['useGetUserQuery() UnusedDocument'],
          DEFAULT_USAGE_PATTERNS,
        ),
      ).toEqual([]);
    });
  });

  describe('buildJsonReport', () => {
    it('serializes unused operations and fragments with a summary', () => {
      expect(
        buildJsonReport(
          [{ name: 'A', type: 'query', filePath: 'a.gql', line: 3 }],
          [{ name: 'F', filePath: 'b.gql', line: 7 }],
        ),
      ).toEqual({
        unusedOperations: [
          { name: 'A', type: 'query', file: 'a.gql', line: 3 },
        ],
        unusedFragments: [{ name: 'F', file: 'b.gql', line: 7 }],
        summary: { unusedOperations: 1, unusedFragments: 1 },
      });
    });

    it('produces empty arrays and a zeroed summary when nothing is unused', () => {
      expect(buildJsonReport([], [])).toEqual({
        unusedOperations: [],
        unusedFragments: [],
        summary: { unusedOperations: 0, unusedFragments: 0 },
      });
    });
  });

  describe('formatAnnotations', () => {
    it('formats ::warning lines with file and line for ops and fragments', () => {
      expect(
        formatAnnotations(
          [
            {
              name: 'GetUser',
              type: 'query',
              filePath: 'graphql/user.gql',
              line: 3,
            },
          ],
          [{ name: 'UserFields', filePath: 'graphql/user.gql', line: 8 }],
        ),
      ).toEqual([
        '::warning file=graphql/user.gql,line=3::Unused GraphQL operation "GetUser" (query)',
        '::warning file=graphql/user.gql,line=8::Unused GraphQL fragment "UserFields"',
      ]);
    });

    it('omits the line property when no line is available', () => {
      expect(
        formatAnnotations(
          [{ name: 'X', type: 'query', filePath: 'a.gql' }],
          [],
        ),
      ).toEqual(['::warning file=a.gql::Unused GraphQL operation "X" (query)']);
    });

    it('returns [] when nothing is unused', () => {
      expect(formatAnnotations([], [])).toEqual([]);
    });
  });

  describe('mainFunction', () => {
    let exitSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;
    const logged = () => logSpy.mock.calls.flat().join('\n');

    beforeEach(() => {
      jest.clearAllMocks();
      exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit:${code}`);
      });
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
      process.exitCode = 0; // report paths set exitCode; don't leak to the runner
    });

    it('exits 1 when the config file cannot be read', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('no file');
      });
      expect(() => mainFunction()).toThrow('process.exit:1');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 when the GraphQL directory does not exist', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValueOnce(false); // graphqlDir missing
      expect(() => mainFunction()).toThrow('process.exit:1');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('exits 1 when the source directory does not exist', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValueOnce(true).mockReturnValueOnce(false);
      expect(() => mainFunction()).toThrow('process.exit:1');
    });

    it('exits 1 and lists unused operations', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql']) // gql files
        .mockReturnValueOnce(['App.tsx']); // source files
      mockedExtract.mockReturnValue([
        { name: 'GetUser', type: 'query', filePath: 'a.gql' },
        { name: 'Unused', type: 'query', filePath: 'a.gql' },
      ]);
      mockedRead.mockReturnValue(['const r = useGetUserQuery()']);

      mainFunction();
      expect(process.exitCode).toBe(1);
      expect(logged()).toContain('Unused');
      expect(logged()).toContain('unused GraphQL operations');
    });

    it('does not exit and reports success when nothing is unused', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue([
        { name: 'GetUser', type: 'query', filePath: 'a.gql' },
      ]);
      mockedRead.mockReturnValue(['useGetUserQuery()']);

      expect(() => mainFunction()).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(logged()).toContain('No unused');
    });

    it('exits 1 and lists unused fragments even when operations are clean', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue([]); // no operations at all
      mockedRead.mockReturnValue(['']);
      mockedUnusedFragments.mockReturnValueOnce([
        { name: 'DeadFragment', filePath: 'a.gql' },
      ]);

      mainFunction();
      expect(process.exitCode).toBe(1);
      expect(logged()).toContain('DeadFragment');
      expect(logged()).toContain('unused GraphQL fragments');
    });

    it('passes gqlFiles, source contents, and fragment patterns to the corpus scan', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\nfragmentUsagePatterns:\n  - "{Name}FragmentDoc"\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue([]);
      mockedRead.mockReturnValue(['source']);

      expect(() => mainFunction()).not.toThrow();
      expect(mockedUnusedFragments).toHaveBeenCalledWith(
        ['a.gql'],
        ['source'],
        ['{Name}FragmentDoc'],
      );
    });

    it('outputs a JSON report and suppresses info logs in --json mode', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue([
        { name: 'GetUser', type: 'query', filePath: 'a.gql', line: 1 },
        { name: 'Unused', type: 'query', filePath: 'a.gql', line: 2 },
      ]);
      mockedRead.mockReturnValue(['useGetUserQuery()']);
      mockedUnusedFragments.mockReturnValueOnce([
        { name: 'DeadFrag', filePath: 'a.gql', line: 5 },
      ]);

      mainFunction({ json: true });
      expect(process.exitCode).toBe(1);
      const out = logged();
      expect(out).not.toContain('Found ');
      const report = JSON.parse(out);
      expect(report.unusedOperations).toEqual([
        { name: 'Unused', type: 'query', file: 'a.gql', line: 2 },
      ]);
      expect(report.unusedFragments).toEqual([
        { name: 'DeadFrag', file: 'a.gql', line: 5 },
      ]);
      expect(report.summary).toEqual({
        unusedOperations: 1,
        unusedFragments: 1,
      });
    });

    it('emits an empty JSON report and exits 0 when nothing is unused (--json)', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue([
        { name: 'GetUser', type: 'query', filePath: 'a.gql', line: 1 },
      ]);
      mockedRead.mockReturnValue(['useGetUserQuery()']);

      expect(() => mainFunction({ json: true })).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
      const report = JSON.parse(logged());
      expect(report.summary).toEqual({
        unusedOperations: 0,
        unusedFragments: 0,
      });
    });

    it('emits GitHub annotations to stderr when annotate is set', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue([
        { name: 'Dead', type: 'query', filePath: 'a.gql', line: 4 },
      ]);
      mockedRead.mockReturnValue(['']);

      mainFunction({ annotate: true });
      expect(process.exitCode).toBe(1);
      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain(
        '::warning file=a.gql,line=4::Unused GraphQL operation "Dead" (query)',
      );
    });
  });
});
