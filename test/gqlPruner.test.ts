import * as fs from 'fs';
import * as fileUtils from '../src/utils/fileUtils';
import { extractOperations } from '../src/utils/operations';
import * as fragments from '../src/utils/fragments';
import {
  buildJsonReport,
  DEFAULT_EXCLUDED_FOLDERS,
  detectGeneratedFiles,
  explainOperationUsage,
  findUnusedOperations,
  formatAnnotations,
  formatGeneratedFileWarnings,
  formatVerboseConfigLines,
  formatVerboseScanLines,
  mainFunction,
  resolveConfig,
  resolveDirs,
  resolveExcludePatterns,
  resolveFragmentUsagePatterns,
  resolveUsagePatterns,
  scanProject,
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
    readSourceFiles: jest.fn(),
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
const mockedReadSources = fileUtils.readSourceFiles as jest.Mock;
const mockedExtract = extractOperations as jest.Mock;
const mockedUnusedFragments =
  fragments.findUnusedFragmentsInCorpus as jest.Mock;

describe('gqlPruner', () => {
  describe('resolveExcludePatterns', () => {
    it('always includes node_modules and .git', () => {
      expect(resolveExcludePatterns({ graphqlDir: 'g', srcDir: 's' })).toEqual(
        DEFAULT_EXCLUDED_FOLDERS,
      );
    });

    it('combines exclude globs with the deprecated excludedFolders', () => {
      expect(
        resolveExcludePatterns({
          graphqlDir: 'g',
          srcDir: 's',
          exclude: '**/dist',
          excludedFolders: ['legacy'],
        }),
      ).toEqual(['**/dist', 'legacy', 'node_modules', '.git']);
    });

    it('de-dupes against the defaults', () => {
      expect(
        resolveExcludePatterns({
          graphqlDir: 'g',
          srcDir: 's',
          excludedFolders: ['a', 'node_modules'],
        }),
      ).toEqual(['a', 'node_modules', '.git']);
    });

    it('carries exclude negations alongside the deprecated excludedFolders', () => {
      // The matcher is order-insensitive (negatives always win — see
      // createExcludeMatcher), so this just confirms both fields reach it.
      expect(
        resolveExcludePatterns({
          graphqlDir: 'g',
          srcDir: 's',
          excludedFolders: ['legacy'],
          exclude: ['!legacy/keep.ts'],
        }),
      ).toEqual(['!legacy/keep.ts', 'legacy', 'node_modules', '.git']);
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

  describe('explainOperationUsage', () => {
    const ops: OperationInfo[] = [
      { name: 'GetUser', type: 'query', filePath: 'a.gql' },
      { name: 'Unused', type: 'query', filePath: 'a.gql' },
    ];
    const sources = [
      { file: 'src/App.tsx', content: 'const r = useGetUserQuery()' },
      { file: 'src/Other.tsx', content: 'nothing here' },
    ];

    it('records the matching pattern and file for a used operation', () => {
      const [usage] = explainOperationUsage(
        [ops[0]],
        sources,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(usage.operation.name).toBe('GetUser');
      expect(usage.match).toEqual({
        pattern: 'useGetUserQuery',
        file: 'src/App.tsx',
      });
    });

    it('leaves match absent for an unused operation, keeping the searched patterns', () => {
      const [usage] = explainOperationUsage(
        [ops[1]],
        sources,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(usage.match).toBeUndefined();
      expect(usage.patterns).toEqual([
        'useUnusedQuery',
        'useUnusedLazyQuery',
        'useUnusedSuspenseQuery',
        'UnusedDocument',
      ]);
    });

    it('agrees with findUnusedOperations on the unused set', () => {
      const usages = explainOperationUsage(
        ops,
        sources,
        DEFAULT_USAGE_PATTERNS,
      );
      const unusedViaExplain = usages
        .filter((usage) => !usage.match)
        .map((usage) => usage.operation);
      expect(unusedViaExplain).toEqual(
        findUnusedOperations(
          ops,
          sources.map((source) => source.content),
          DEFAULT_USAGE_PATTERNS,
        ),
      );
    });

    it('returns [] for no operations', () => {
      expect(
        explainOperationUsage([], sources, DEFAULT_USAGE_PATTERNS),
      ).toEqual([]);
    });
  });

  describe('formatVerboseConfigLines', () => {
    it('renders the resolved dirs, excludes and patterns', () => {
      const lines = formatVerboseConfigLines({
        graphqlDir: './g',
        srcDir: ['./s1', './s2'],
        exclude: '**/dist',
        usagePatterns: ['{Name}Doc'],
      });
      const text = lines.join('\n');
      expect(text).toContain('graphqlDir: ./g');
      expect(text).toContain('srcDir: ./s1, ./s2');
      expect(text).toContain('exclude: **/dist, node_modules, .git');
      expect(text).toContain('usagePatterns: {Name}Doc');
      expect(text).toContain('fragmentUsagePatterns: {Name}FragmentDoc');
    });
  });

  describe('formatVerboseScanLines', () => {
    const baseResult = {
      gqlFileCount: 1,
      sourceFileCount: 3,
      operationCount: 2,
      gqlFiles: ['graphql/user.gql'],
      unusedOperations: [],
      unusedFragments: [],
      generatedWarnings: [],
      generatedFiles: [],
    };

    it('lists the gql files, source count, and one verdict line per operation', () => {
      const lines = formatVerboseScanLines({
        ...baseResult,
        operationUsages: [
          {
            operation: { name: 'GetUser', type: 'query', filePath: 'a.gql' },
            patterns: ['useGetUserQuery'],
            match: { pattern: 'useGetUserQuery', file: 'src/App.tsx' },
          },
          {
            operation: { name: 'Dead', type: 'mutation', filePath: 'a.gql' },
            patterns: ['useDeadMutation', 'DeadDocument'],
          },
        ],
      });
      const text = lines.join('\n');
      expect(text).toContain('GraphQL files (1): graphql/user.gql');
      expect(text).toContain('Source files scanned: 3');
      expect(text).toContain('GetUser');
      expect(text).toContain('"useGetUserQuery" found in src/App.tsx');
      expect(text).toContain('Dead');
      expect(text).toContain('useDeadMutation, DeadDocument');
    });

    it('handles a scan with no operations', () => {
      const lines = formatVerboseScanLines({
        ...baseResult,
        operationCount: 0,
        operationUsages: [],
      });
      expect(lines.join('\n')).toContain('Source files scanned: 3');
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
        warnings: [],
        summary: { unusedOperations: 1, unusedFragments: 1 },
      });
    });

    it('produces empty arrays and a zeroed summary when nothing is unused', () => {
      expect(buildJsonReport([], [])).toEqual({
        unusedOperations: [],
        unusedFragments: [],
        warnings: [],
        summary: { unusedOperations: 0, unusedFragments: 0 },
      });
    });

    it('includes provided warnings verbatim', () => {
      expect(buildJsonReport([], [], ['heads up']).warnings).toEqual([
        'heads up',
      ]);
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

    it('escapes : and , in the file property (e.g. Windows paths)', () => {
      expect(
        formatAnnotations(
          [{ name: 'X', type: 'query', filePath: 'C:\\a,b\\q.gql', line: 1 }],
          [],
        ),
      ).toEqual([
        '::warning file=C%3A\\a%2Cb\\q.gql,line=1::Unused GraphQL operation "X" (query)',
      ]);
    });

    it('returns [] when nothing is unused', () => {
      expect(formatAnnotations([], [])).toEqual([]);
    });
  });

  describe('detectGeneratedFiles', () => {
    const makeOps = (names: string[]): OperationInfo[] =>
      names.map((name) => ({ name, type: 'query', filePath: 'ops.gql' }));
    // A codegen-style file that "references" each operation via its document const.
    const docs = (ops: OperationInfo[]): string =>
      ops.map((op) => `export const ${op.name}Document = {};`).join('\n');

    it('flags a single file that references >= 70% of all operations', () => {
      const ops = makeOps(['GetUser', 'GetPost', 'GetTag', 'GetFoo', 'GetBar']);
      const warnings = detectGeneratedFiles(
        [
          { file: 'src/gql/graphql.ts', content: docs(ops) }, // all 5
          { file: 'src/App.tsx', content: 'const r = useGetUserQuery();' }, // 1
        ],
        ops,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].file).toBe('src/gql/graphql.ts');
      expect(warnings[0].coverage).toBeCloseTo(1);
      expect(warnings[0].matchedOperations).toBe(5);
      expect(warnings[0].reasons).toEqual(
        expect.arrayContaining(['coverage', 'filename']),
      );
    });

    it('does not flag when no single file reaches the threshold', () => {
      const ops = makeOps(['A', 'B', 'C', 'D', 'E']);
      const warnings = detectGeneratedFiles(
        [
          { file: 'a.ts', content: docs(makeOps(['A', 'B'])) }, // 40%
          { file: 'b.ts', content: docs(makeOps(['C', 'D'])) }, // 40%
          { file: 'c.ts', content: docs(makeOps(['E'])) }, // 20%
        ],
        ops,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(warnings).toEqual([]);
    });

    it('does not flag a generated-looking file with no operation coverage (coverage-gated)', () => {
      const ops = makeOps(['A', 'B', 'C', 'D', 'E']);
      const warnings = detectGeneratedFiles(
        [
          {
            // Generated filename AND header, but references zero operations.
            file: 'src/prisma/client.generated.ts',
            content: '// @generated by prisma\nexport class PrismaClient {}',
          },
          { file: 'a.ts', content: docs(makeOps(['A', 'B', 'C'])) }, // 60%
          { file: 'b.ts', content: docs(makeOps(['D', 'E'])) }, // 40%
        ],
        ops,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(warnings).toEqual([]);
    });

    it('does not flag below the minimum operation count, even at 100% coverage', () => {
      const ops = makeOps(['A', 'B', 'C']); // 3 < floor
      const warnings = detectGeneratedFiles(
        [{ file: 'src/gql/graphql.ts', content: docs(ops) }],
        ops,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(warnings).toEqual([]);
    });

    it('flags on coverage alone (no generated name or header) at the 70% boundary', () => {
      const ops = makeOps(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
      const warnings = detectGeneratedFiles(
        [{ file: 'src/big-barrel.ts', content: docs(ops.slice(0, 7)) }], // 7/10
        ops,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].coverage).toBeCloseTo(0.7);
      expect(warnings[0].reasons).toEqual(['coverage']);
    });

    it('adds a "header" reason for a generated header without a generated filename', () => {
      const ops = makeOps(['A', 'B', 'C', 'D', 'E']);
      const warnings = detectGeneratedFiles(
        [
          {
            file: 'src/api/all-operations.ts',
            content: `/* eslint-disable */\n${docs(ops)}`,
          },
        ],
        ops,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0].reasons).toEqual(
        expect.arrayContaining(['coverage', 'header']),
      );
      expect(warnings[0].reasons).not.toContain('filename');
    });

    it('recognizes files under a __generated__ folder', () => {
      const ops = makeOps(['A', 'B', 'C', 'D', 'E']);
      const [warning] = detectGeneratedFiles(
        [{ file: 'src/api/__generated__/types.ts', content: docs(ops) }],
        ops,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(warning.reasons).toContain('filename');
    });

    it('recognizes a gql/index.ts barrel file', () => {
      const ops = makeOps(['A', 'B', 'C', 'D', 'E']);
      const [warning] = detectGeneratedFiles(
        [{ file: 'src/gql/index.ts', content: docs(ops) }],
        ops,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(warning.reasons).toContain('filename');
    });
  });

  describe('formatGeneratedFileWarnings', () => {
    it('renders a readable line with file, percentage and an exclude hint', () => {
      const [line] = formatGeneratedFileWarnings([
        {
          file: 'src/gql/graphql.ts',
          coverage: 0.98,
          matchedOperations: 49,
          totalOperations: 50,
          reasons: ['coverage', 'filename'],
        },
      ]);
      expect(line).toContain('src/gql/graphql.ts');
      expect(line).toContain('98%');
      expect(line).toContain('exclude');
    });

    it('returns [] when there are no warnings', () => {
      expect(formatGeneratedFileWarnings([])).toEqual([]);
    });
  });

  describe('resolveConfig', () => {
    const enoent = () => {
      const err = new Error('missing') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    };

    it('reads the YAML file when present', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      expect(resolveConfig()).toEqual({ graphqlDir: './g', srcDir: './s' });
    });

    it('treats an empty config file as no config (CLI flags still apply)', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('');
      expect(resolveConfig({ graphqlDir: './g', srcDir: './s' })).toEqual({
        graphqlDir: './g',
        srcDir: './s',
      });
    });

    it('uses CLI config alone when the file is missing (ENOENT)', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(enoent);
      expect(resolveConfig({ graphqlDir: './g', srcDir: './s' })).toEqual({
        graphqlDir: './g',
        srcDir: './s',
      });
    });

    it('lets CLI flags override YAML values per field', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./yaml-g\nsrcDir: ./yaml-s\n',
      );
      expect(resolveConfig({ srcDir: './cli-s' })).toEqual({
        graphqlDir: './yaml-g',
        srcDir: './cli-s',
      });
    });

    it('replaces (not merges) a YAML list when a list flag is given', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'excludedFolders:\n  - yaml-only\n',
      );
      expect(resolveConfig({ excludedFolders: ['cli-only'] })).toEqual({
        excludedFolders: ['cli-only'],
      });
    });

    it('throws on a malformed config file', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('graphqlDir: [');
      expect(() => resolveConfig()).toThrow();
    });

    it('rethrows a non-ENOENT read error', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        const err = new Error('eacces') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      });
      expect(() => resolveConfig()).toThrow('eacces');
    });
  });

  describe('resolveDirs', () => {
    it('wraps a single string', () => {
      expect(resolveDirs('./graphql')).toEqual(['./graphql']);
    });

    it('trims entries and drops blanks from an array', () => {
      expect(resolveDirs(['./a', '  ./b  ', ''])).toEqual(['./a', './b']);
    });

    it('returns [] for undefined', () => {
      expect(resolveDirs(undefined)).toEqual([]);
    });

    it('returns [] for a blank string', () => {
      expect(resolveDirs('   ')).toEqual([]);
    });

    it('drops non-string entries (defensive against malformed YAML)', () => {
      const value = ['./a', 8080, null, './b'] as unknown as string[];
      expect(resolveDirs(value)).toEqual(['./a', './b']);
    });
  });

  describe('scanProject', () => {
    beforeEach(() => jest.clearAllMocks());

    it('scans multiple graphql/src directories and de-duplicates files', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql']) // graphqlDir[0]
        .mockReturnValueOnce(['a.gql', 'b.gql']) // graphqlDir[1] (a.gql overlaps)
        .mockReturnValueOnce(['App.tsx']); // srcDir
      mockedExtract.mockReturnValue([]);
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      const result = scanProject({ graphqlDir: ['g1', 'g2'], srcDir: 's' });

      expect(result.gqlFileCount).toBe(2); // a.gql counted once
      expect(result.sourceFileCount).toBe(1);
    });

    it('aggregates files, operations, unused results and warnings', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql']) // gql files
        .mockReturnValueOnce(['App.tsx']); // source files
      mockedExtract.mockReturnValue([
        { name: 'GetUser', type: 'query', filePath: 'a.gql' },
        { name: 'Unused', type: 'query', filePath: 'a.gql' },
      ]);
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      const result = scanProject({ graphqlDir: './g', srcDir: './s' });

      expect(result.gqlFileCount).toBe(1);
      expect(result.sourceFileCount).toBe(1);
      expect(result.operationCount).toBe(2);
      expect(result.unusedOperations.map((op) => op.name)).toEqual(['Unused']);
      expect(result.unusedFragments).toEqual([]);
      expect(result.generatedWarnings).toEqual([]);
      expect(result.generatedFiles).toEqual([]);
    });

    it('exposes the scanned gql files and a usage explanation per operation', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql']) // gql files
        .mockReturnValueOnce(['App.tsx']); // source files
      mockedExtract.mockReturnValue([
        { name: 'GetUser', type: 'query', filePath: 'a.gql' },
        { name: 'Unused', type: 'query', filePath: 'a.gql' },
      ]);
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      const result = scanProject({ graphqlDir: './g', srcDir: './s' });

      expect(result.gqlFiles).toEqual(['a.gql']);
      expect(result.operationUsages).toHaveLength(2);
      expect(result.operationUsages[0].match).toEqual({
        pattern: 'useGetUserQuery',
        file: 'App.tsx',
      });
      expect(result.operationUsages[1].match).toBeUndefined();
    });

    it('exposes the raw detected generated files (for init auto-exclude)', () => {
      const ops = ['A', 'B', 'C', 'D', 'E'].map((name) => ({
        name,
        type: 'query' as const,
        filePath: 'a.gql',
      }));
      mockedFind
        .mockReturnValueOnce(['a.gql']) // gql files
        .mockReturnValueOnce(['graphql.ts']); // source files
      mockedExtract.mockReturnValue(ops);
      // One file references every operation (via {Name}Document) → coverage 1.0.
      mockedReadSources.mockReturnValue([
        {
          file: 'src/gql/graphql.ts',
          content: 'ADocument BDocument CDocument DDocument EDocument',
        },
      ]);

      const result = scanProject({ graphqlDir: './g', srcDir: './s' });

      expect(result.generatedFiles.map((w) => w.file)).toEqual([
        'src/gql/graphql.ts',
      ]);
      expect(result.generatedWarnings).toHaveLength(1);
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

    it('exits 1 and names a missing directory in an array config', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir:\n  - ./g1\n  - ./g2\nsrcDir: ./s\n',
      );
      mockedDirExists.mockImplementation((dir: string) => dir !== './g2');
      expect(() => mainFunction()).toThrow('process.exit:1');
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('./g2');
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
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'const r = useGetUserQuery()' },
      ]);

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
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

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
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);
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
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'source' },
      ]);

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
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);
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
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

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
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      mainFunction({ annotate: true });
      expect(process.exitCode).toBe(1);
      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain(
        '::warning file=a.gql,line=4::Unused GraphQL operation "Dead" (query)',
      );
    });

    it('warns on stderr and in the JSON report when one file masks most operations', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      const ops = ['A', 'B', 'C', 'D', 'E'].map((name) => ({
        name,
        type: 'query',
        filePath: 'a.gql',
        line: 1,
      }));
      mockedFind
        .mockReturnValueOnce(['a.gql']) // gql files
        .mockReturnValueOnce(['src/gql/graphql.ts']); // source files
      mockedExtract.mockReturnValue(ops);
      mockedReadSources.mockReturnValue([
        {
          file: 'src/gql/graphql.ts',
          content: ops.map((op) => `${op.name}Document`).join('\n'),
        },
      ]);

      mainFunction({ json: true });

      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain('Suspected generated file "src/gql/graphql.ts"');
      expect(errs).toContain('exclude');

      const report = JSON.parse(logged());
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0]).toContain('src/gql/graphql.ts');
      // Every operation looks "used" because of the generated file → none reported.
      expect(report.summary.unusedOperations).toBe(0);
    });

    it('emits the masking warning as an escaped ::warning annotation in annotate mode', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      const ops = ['A', 'B', 'C', 'D', 'E'].map((name) => ({
        name,
        type: 'query',
        filePath: 'a.gql',
        line: 1,
      }));
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['src/gql/graphql.ts']);
      mockedExtract.mockReturnValue(ops);
      mockedReadSources.mockReturnValue([
        {
          file: 'src/gql/graphql.ts',
          content: ops.map((op) => `${op.name}Document`).join('\n'),
        },
      ]);

      mainFunction({ annotate: true });

      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain('::warning::Suspected generated file');
      // The "%" in "100%" is escaped for the workflow command.
      expect(errs).toContain('100%25');
    });

    it('logs the resolved config and per-operation verdicts to stderr with --verbose', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue([
        { name: 'GetUser', type: 'query', filePath: 'a.gql' },
        { name: 'Dead', type: 'query', filePath: 'a.gql' },
      ]);
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'const r = useGetUserQuery()' },
      ]);

      mainFunction({ verbose: true });

      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain('graphqlDir: ./g');
      expect(errs).toContain('srcDir: ./s');
      expect(errs).toContain('GraphQL files (1): a.gql');
      expect(errs).toContain('"useGetUserQuery" found in App.tsx');
      expect(errs).toContain('Dead');
      // Verbose lines must never leak to stdout.
      expect(logged()).not.toContain('found in App.tsx');
    });

    it('keeps stdout pure JSON when --verbose and --json are combined', () => {
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
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      mainFunction({ json: true, verbose: true });

      // stdout parses as JSON on its own…
      const report = JSON.parse(logged());
      expect(report.summary).toEqual({
        unusedOperations: 0,
        unusedFragments: 0,
      });
      // …and the verbose detail went to stderr.
      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain('"useGetUserQuery" found in App.tsx');
    });

    it('emits no verbose lines by default', () => {
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
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      mainFunction();

      expect(errorSpy.mock.calls.flat().join('\n')).not.toContain(
        'found in App.tsx',
      );
    });

    it('runs from CLI config when no config file exists', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue([
        { name: 'GetUser', type: 'query', filePath: 'a.gql' },
      ]);
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      expect(() =>
        mainFunction({ config: { graphqlDir: './g', srcDir: './s' } }),
      ).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(logged()).toContain('No unused');
    });

    it('exits 1 with guidance when neither a config file nor flags supply dirs', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });

      expect(() => mainFunction()).toThrow('process.exit:1');
      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain('--graphql');
    });
  });
});
