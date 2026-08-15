// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as fs from 'fs';
import { buildSchema, parse, Source } from 'graphql';
import * as fileUtils from '../src/utils/fileUtils';
import { extractGraphqlEntities } from '../src/utils/operations';
import * as fragments from '../src/utils/fragments';
import {
  buildJsonReport,
  CANDIDATE_REMINDER,
  createConfigExcludeMatcher,
  DEFAULT_EXCLUDED_FOLDERS,
  detectGeneratedFiles,
  explainOperationUsage,
  findDuplicateNameWarnings,
  findUnusedOperations,
  formatAnnotations,
  formatExpandedDirLines,
  formatGeneratedFileWarnings,
  formatVerboseConfigLines,
  formatVerboseScanLines,
  mainFunction,
  resolveCheckFields,
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
// Partial mock again: only the filesystem-backed extractor is stubbed, so the
// pure AST helpers (getFragmentSpreads) stay real for the field pass.
jest.mock('../src/utils/operations', () => ({
  ...jest.requireActual('../src/utils/operations'),
  extractGraphqlEntities: jest.fn(),
}));
jest.mock('../src/utils/fragments', () => ({
  ...jest.requireActual('../src/utils/fragments'),
  findUnusedFragmentsInCorpus: jest.fn(() => []),
}));

const mockedDirExists = fileUtils.directoryExists as jest.Mock;
const mockedFind = fileUtils.findFilesWithExtension as jest.Mock;
const mockedReadSources = fileUtils.readSourceFiles as jest.Mock;
const mockedExtract = extractGraphqlEntities as jest.Mock;

// The parsed-file shape extractGraphqlEntities returns for a file whose only
// contents are the given operations.
const entitiesOf = (operations: OperationInfo[], filePath = 'a.gql') => ({
  operations,
  fragments: [],
  operationSpreads: [],
  fragmentSpreads: [],
  filePath,
  imports: [],
  hasAnonymousOperation: false,
  document: null,
});
// Like entitiesOf, but carrying a real parsed document so the opt-in field pass
// has selection sets (and locations) to walk.
const entitiesWithDocument = (
  filePath: string,
  text: string,
  operations: OperationInfo[] = [],
) => ({
  ...entitiesOf(operations, filePath),
  document: parse(new Source(text, filePath)),
});
const mockedUnusedFragments =
  fragments.findUnusedFragmentsInCorpus as jest.Mock;

// SDL and a matching parsed file, for the opt-in deprecated-field checks.
const SDL = [
  'type User { id: ID!, nickname: String @deprecated(reason: "use displayName")',
  '  legacyName: String @deprecated(reason: "use displayName") }',
  'type Query { user: User }',
].join('\n');
const DEPRECATED_QUERY = 'query GetUser {\n  user {\n    nickname\n  }\n}';

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

  describe('createConfigExcludeMatcher', () => {
    it('keeps node_modules and .git excluded even against a "!" re-include', () => {
      const matcher = createConfigExcludeMatcher({
        graphqlDir: 'g',
        srcDir: 's',
        exclude: ['!node_modules', '!.git'],
      });
      expect(matcher('node_modules')).toBe(true);
      expect(matcher('.git')).toBe(true);
    });

    it('lets "!" re-includes work within the user patterns', () => {
      const matcher = createConfigExcludeMatcher({
        graphqlDir: 'g',
        srcDir: 's',
        exclude: ['*.gen.ts', '!keep.gen.ts'],
      });
      expect(matcher('a.gen.ts')).toBe(true);
      expect(matcher('keep.gen.ts')).toBe(false);
    });

    it('lets an exclude negation re-include a deprecated excludedFolders entry', () => {
      const matcher = createConfigExcludeMatcher({
        graphqlDir: 'g',
        srcDir: 's',
        excludedFolders: ['legacy'],
        exclude: ['!legacy'],
      });
      expect(matcher('legacy')).toBe(false);
    });

    it('excludes the defaults when no patterns are configured', () => {
      const matcher = createConfigExcludeMatcher({
        graphqlDir: 'g',
        srcDir: 's',
      });
      expect(matcher('node_modules')).toBe(true);
      expect(matcher('src')).toBe(false);
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

  describe('resolveCheckFields', () => {
    it('is off when the option is absent', () => {
      expect(resolveCheckFields({ graphqlDir: 'g', srcDir: 's' })).toBe(false);
    });

    it('is on for an explicit true', () => {
      expect(
        resolveCheckFields({ graphqlDir: 'g', srcDir: 's', checkFields: true }),
      ).toBe(true);
    });

    it('is off for a non-boolean YAML value', () => {
      expect(
        resolveCheckFields({
          graphqlDir: 'g',
          srcDir: 's',
          checkFields: 'yes' as unknown as boolean,
        }),
      ).toBe(false);
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
      expect(text).not.toContain('schemaFile');
    });

    it('adds a schemaFile line only when one is configured', () => {
      const lines = formatVerboseConfigLines({
        graphqlDir: './g',
        srcDir: './s',
        schemaFile: './schema.graphql',
      });
      expect(lines.join('\n')).toContain('schemaFile: ./schema.graphql');
    });
  });

  describe('formatExpandedDirLines', () => {
    it('lists the directories a pattern expanded to', () => {
      expect(
        formatExpandedDirLines(
          'graphqlDir',
          ['packages/*/graphql'],
          ['packages/web/graphql', 'packages/admin/graphql'],
        ),
      ).toEqual([
        'graphqlDir (expanded): packages/web/graphql, packages/admin/graphql',
      ]);
    });

    it('says nothing when expansion changed nothing', () => {
      expect(formatExpandedDirLines('srcDir', ['./s'], ['./s'])).toEqual([]);
      expect(formatExpandedDirLines('srcDir', [], [])).toEqual([]);
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
      orphanedFiles: [],
      deprecatedUsages: [],
      unusedFieldCandidates: [],
      duplicateWarnings: [],
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

  describe('findDuplicateNameWarnings', () => {
    const file = (
      operations: { name: string; filePath: string }[] = [],
      fragments: { name: string; filePath: string }[] = [],
    ) => ({
      operations: operations.map((op) => ({ ...op, type: 'query' as const })),
      fragments,
      operationSpreads: [],
      fragmentSpreads: [],
      filePath: operations[0]?.filePath ?? fragments[0]?.filePath ?? 'a.gql',
      imports: [],
      hasAnonymousOperation: false,
      document: null,
    });

    it('warns when an operation name is defined in two files', () => {
      const warnings = findDuplicateNameWarnings([
        file([{ name: 'GetUser', filePath: 'a.gql' }]),
        file([{ name: 'GetUser', filePath: 'b.gql' }]),
      ]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('operation');
      expect(warnings[0]).toContain('"GetUser"');
      expect(warnings[0]).toContain('a.gql');
      expect(warnings[0]).toContain('b.gql');
    });

    it('warns on a duplicate defined twice within one file', () => {
      const warnings = findDuplicateNameWarnings([
        file([
          { name: 'GetUser', filePath: 'a.gql' },
          { name: 'GetUser', filePath: 'a.gql' },
        ]),
      ]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('"GetUser"');
    });

    it('warns when a fragment name is defined in two files', () => {
      const warnings = findDuplicateNameWarnings([
        file([], [{ name: 'UserFields', filePath: 'a.gql' }]),
        file([], [{ name: 'UserFields', filePath: 'b.gql' }]),
      ]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('fragment');
      expect(warnings[0]).toContain('"UserFields"');
    });

    it('does not conflate an operation and a fragment sharing a name', () => {
      expect(
        findDuplicateNameWarnings([
          file(
            [{ name: 'User', filePath: 'a.gql' }],
            [{ name: 'User', filePath: 'b.gql' }],
          ),
        ]),
      ).toEqual([]);
    });

    it('returns [] when every name is unique', () => {
      expect(
        findDuplicateNameWarnings([
          file(
            [{ name: 'A', filePath: 'a.gql' }],
            [{ name: 'B', filePath: 'a.gql' }],
          ),
        ]),
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
        orphanedFiles: [],
        deprecatedUsages: [],
        warnings: [],
        summary: {
          unusedOperations: 1,
          unusedFragments: 1,
          orphanedFiles: 0,
          deprecatedUsages: 0,
        },
      });
    });

    it('produces empty arrays and a zeroed summary when nothing is unused', () => {
      expect(buildJsonReport([], [])).toEqual({
        unusedOperations: [],
        unusedFragments: [],
        orphanedFiles: [],
        deprecatedUsages: [],
        warnings: [],
        summary: {
          unusedOperations: 0,
          unusedFragments: 0,
          orphanedFiles: 0,
          deprecatedUsages: 0,
        },
      });
    });

    it('includes provided warnings verbatim', () => {
      expect(buildJsonReport([], [], ['heads up']).warnings).toEqual([
        'heads up',
      ]);
    });

    it('lists the orphaned files and counts them in the summary', () => {
      const report = buildJsonReport(
        [{ name: 'A', type: 'query', filePath: 'dead.gql' }],
        [],
        [],
        ['dead.gql'],
      );
      expect(report.orphanedFiles).toEqual(['dead.gql']);
      expect(report.summary.orphanedFiles).toBe(1);
    });

    it('serializes deprecated usages and counts them in the summary', () => {
      const report = buildJsonReport(
        [],
        [],
        [],
        [],
        [
          {
            message: 'The field User.nickname is deprecated. use displayName',
            file: 'graphql/user.gql',
            line: 3,
          },
        ],
      );
      expect(report.deprecatedUsages).toEqual([
        {
          message: 'The field User.nickname is deprecated. use displayName',
          file: 'graphql/user.gql',
          line: 3,
        },
      ]);
      expect(report.summary.deprecatedUsages).toBe(1);
    });

    it('omits unusedFields entirely when the field check did not run', () => {
      const report = buildJsonReport([], []);
      expect(report).not.toHaveProperty('unusedFields');
      expect(report.summary).not.toHaveProperty('unusedFields');
    });

    it('serializes field candidates and counts them in the summary', () => {
      const report = buildJsonReport(
        [],
        [],
        [],
        [],
        [],
        [{ field: 'avatarUrl', locations: [{ file: 'a.gql', line: 4 }] }],
      );
      expect(report.unusedFields).toEqual([
        { field: 'avatarUrl', locations: [{ file: 'a.gql', line: 4 }] },
      ]);
      expect(report.summary).toEqual({
        unusedOperations: 0,
        unusedFragments: 0,
        orphanedFiles: 0,
        deprecatedUsages: 0,
        unusedFields: 1,
      });
    });

    it('keeps an empty unusedFields when the check ran and found nothing', () => {
      const report = buildJsonReport([], [], [], [], [], []);
      expect(report.unusedFields).toEqual([]);
      expect(report.summary.unusedFields).toBe(0);
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

    it('annotates an orphaned file without a line', () => {
      expect(formatAnnotations([], [], ['graphql/dead.gql'])).toEqual([
        '::warning file=graphql/dead.gql::Orphaned GraphQL file: every definition is unused and no document imports it',
      ]);
    });

    it('annotates each field candidate at its first selection', () => {
      expect(
        formatAnnotations(
          [],
          [],
          [],
          [],
          [
            {
              field: 'avatarUrl',
              locations: [
                { file: 'graphql/user.gql', line: 4 },
                { file: 'graphql/post.gql', line: 9 },
              ],
            },
          ],
        ),
      ).toEqual([
        '::warning file=graphql/user.gql,line=4::Unused GraphQL field candidate "avatarUrl" (name not found in source)',
      ]);
    });

    it('omits the line for a field candidate with no known line', () => {
      expect(
        formatAnnotations(
          [],
          [],
          [],
          [],
          [{ field: 'avatarUrl', locations: [{ file: 'a.gql' }] }],
        ),
      ).toEqual([
        '::warning file=a.gql::Unused GraphQL field candidate "avatarUrl" (name not found in source)',
      ]);
    });

    it('returns [] when nothing is unused', () => {
      expect(formatAnnotations([], [])).toEqual([]);
    });

    it('formats one ::warning per deprecated usage', () => {
      expect(
        formatAnnotations(
          [],
          [],
          [],
          [
            {
              message: 'The field User.nickname is deprecated. use displayName',
              file: 'graphql/user.gql',
              line: 3,
            },
            { message: 'The field Query.old is deprecated.', file: 'a.gql' },
          ],
        ),
      ).toEqual([
        '::warning file=graphql/user.gql,line=3::The field User.nickname is deprecated. use displayName',
        '::warning file=a.gql::The field Query.old is deprecated.',
      ]);
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
      mockedExtract.mockReturnValue(entitiesOf([]));
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      const result = scanProject({ graphqlDir: ['g1', 'g2'], srcDir: 's' });

      expect(result.gqlFileCount).toBe(2); // a.gql counted once
      expect(result.sourceFileCount).toBe(1);
    });

    it('aggregates files, operations, unused results and warnings', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql']) // gql files
        .mockReturnValueOnce(['App.tsx']); // source files
      mockedExtract.mockReturnValue(
        entitiesOf([
          { name: 'GetUser', type: 'query', filePath: 'a.gql' },
          { name: 'Unused', type: 'query', filePath: 'a.gql' },
        ]),
      );
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

    it('parses each GraphQL file exactly once and shares the result with the fragment scan', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql', 'b.gql']) // gql files
        .mockReturnValueOnce(['App.tsx']); // source files
      mockedExtract.mockReturnValue(entitiesOf([]));
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      scanProject({ graphqlDir: './g', srcDir: './s' });

      expect(mockedExtract).toHaveBeenCalledTimes(2);
      expect(mockedUnusedFragments).toHaveBeenCalledWith(
        [entitiesOf([]), entitiesOf([])],
        [''],
        DEFAULT_FRAGMENT_USAGE_PATTERNS,
      );
    });

    it('exposes the scanned gql files and a usage explanation per operation', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql']) // gql files
        .mockReturnValueOnce(['App.tsx']); // source files
      mockedExtract.mockReturnValue(
        entitiesOf([
          { name: 'GetUser', type: 'query', filePath: 'a.gql' },
          { name: 'Unused', type: 'query', filePath: 'a.gql' },
        ]),
      );
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

    it('passes the walker a matcher that "!" cannot open node_modules through', () => {
      mockedFind.mockReturnValue([]);
      mockedExtract.mockReturnValue(entitiesOf([]));
      mockedReadSources.mockReturnValue([]);

      scanProject({
        graphqlDir: './g',
        srcDir: './s',
        exclude: ['!node_modules'],
      });

      const isExcluded = mockedFind.mock.calls[0][2];
      expect(isExcluded('node_modules')).toBe(true);
    });

    it('exposes duplicate-name warnings from the parsed corpus', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql', 'b.gql']) // gql files
        .mockReturnValueOnce(['App.tsx']); // source files
      mockedExtract.mockReturnValue(
        entitiesOf([{ name: 'GetUser', type: 'query', filePath: 'a.gql' }]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      // Both parsed files define GetUser (same mock for each) → duplicate.
      const result = scanProject({ graphqlDir: './g', srcDir: './s' });

      expect(result.duplicateWarnings).toHaveLength(1);
      expect(result.duplicateWarnings[0]).toContain('"GetUser"');
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
      mockedExtract.mockReturnValue(entitiesOf(ops));
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

    it('surfaces a file whose every definition is unused as orphaned', () => {
      mockedFind
        .mockReturnValueOnce(['dead.gql']) // gql files
        .mockReturnValueOnce(['App.tsx']); // source files
      mockedExtract.mockReturnValue(
        entitiesOf(
          [{ name: 'Dead', type: 'query', filePath: 'dead.gql' }],
          'dead.gql',
        ),
      );
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      const result = scanProject({ graphqlDir: './g', srcDir: './s' });

      expect(result.orphanedFiles).toEqual(['dead.gql']);
    });

    it('leaves orphanedFiles empty when every definition is used', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql']) // gql files
        .mockReturnValueOnce(['App.tsx']); // source files
      mockedExtract.mockReturnValue(
        entitiesOf([{ name: 'GetUser', type: 'query', filePath: 'a.gql' }]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      const result = scanProject({ graphqlDir: './g', srcDir: './s' });

      expect(result.orphanedFiles).toEqual([]);
    });

    it('reports no deprecated usages when no schema is given', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesWithDocument('a.gql', DEPRECATED_QUERY),
      );
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      const result = scanProject({ graphqlDir: './g', srcDir: './s' });

      expect(result.deprecatedUsages).toEqual([]);
    });

    it('reports deprecated usages when a schema is given', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesWithDocument('a.gql', DEPRECATED_QUERY),
      );
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      const result = scanProject(
        { graphqlDir: './g', srcDir: './s' },
        buildSchema(SDL),
      );

      expect(result.deprecatedUsages).toEqual([
        {
          message: 'The field User.nickname is deprecated. use displayName',
          file: 'a.gql',
          line: 3,
        },
      ]);
    });

    it('skips the field pass entirely unless checkFields is on', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesWithDocument('a.gql', 'query GetUser {\n  avatarUrl\n}', [
          { name: 'GetUser', type: 'query', filePath: 'a.gql' },
        ]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      const result = scanProject({ graphqlDir: './g', srcDir: './s' });

      expect(result.unusedFieldCandidates).toEqual([]);
    });

    it('reports field candidates of used operations when checkFields is on', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesWithDocument('a.gql', 'query GetUser {\n  avatarUrl\n  id\n}', [
          { name: 'GetUser', type: 'query', filePath: 'a.gql' },
        ]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'const { id } = useGetUserQuery().data;' },
      ]);

      const result = scanProject({
        graphqlDir: './g',
        srcDir: './s',
        checkFields: true,
      });

      expect(result.unusedFieldCandidates).toEqual([
        { field: 'avatarUrl', locations: [{ file: 'a.gql', line: 2 }] },
      ]);
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

    it('exits 2 when the config file cannot be read', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('no file');
      });
      expect(() => mainFunction()).toThrow('process.exit:2');
      expect(exitSpy).toHaveBeenCalledWith(2);
    });

    it('exits 2 when the GraphQL directory does not exist', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValueOnce(false); // graphqlDir missing
      expect(() => mainFunction()).toThrow('process.exit:2');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('exits 2 when the source directory does not exist', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValueOnce(true).mockReturnValueOnce(false);
      expect(() => mainFunction()).toThrow('process.exit:2');
    });

    it('exits 2 and names a missing directory in an array config', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir:\n  - ./g1\n  - ./g2\nsrcDir: ./s\n',
      );
      mockedDirExists.mockImplementation((dir: string) => dir !== './g2');
      expect(() => mainFunction()).toThrow('process.exit:2');
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
      mockedExtract.mockReturnValue(
        entitiesOf([
          { name: 'GetUser', type: 'query', filePath: 'a.gql' },
          { name: 'Unused', type: 'query', filePath: 'a.gql' },
        ]),
      );
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
      mockedExtract.mockReturnValue(
        entitiesOf([{ name: 'GetUser', type: 'query', filePath: 'a.gql' }]),
      );
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
      mockedExtract.mockReturnValue(entitiesOf([])); // no operations at all
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);
      mockedUnusedFragments.mockReturnValueOnce([
        { name: 'DeadFragment', filePath: 'a.gql' },
      ]);

      mainFunction();
      expect(process.exitCode).toBe(1);
      expect(logged()).toContain('DeadFragment');
      expect(logged()).toContain('unused GraphQL fragments');
      expect(logged()).toContain(CANDIDATE_REMINDER);
    });

    it('reminds that findings are candidates once there are findings', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesOf([{ name: 'Unused', type: 'query', filePath: 'a.gql' }]),
      );
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      mainFunction();
      const lines = logSpy.mock.calls.flat().map(String);
      const reminders = lines.filter((line) =>
        line.includes(CANDIDATE_REMINDER),
      );
      expect(reminders).toHaveLength(1);
      // It closes the report, after the table it qualifies.
      expect(lines.indexOf(reminders[0])).toBe(lines.length - 1);
    });

    it('omits the candidates reminder when nothing is unused', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesOf([{ name: 'GetUser', type: 'query', filePath: 'a.gql' }]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      mainFunction();
      expect(logged()).not.toContain(CANDIDATE_REMINDER);
    });

    it('lists orphaned files after the fragments section', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['g/dead.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesOf(
          [{ name: 'Dead', type: 'query', filePath: 'g/dead.gql' }],
          'g/dead.gql',
        ),
      );
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      mainFunction();

      const output = logged();
      expect(process.exitCode).toBe(1);
      expect(output).toContain('Orphaned GraphQL Files');
      expect(output).toContain('g/dead.gql');
      expect(output.indexOf('Unused GraphQL Operations')).toBeLessThan(
        output.indexOf('Orphaned GraphQL Files'),
      );
    });

    it('omits the orphaned section when only some definitions in a file are unused', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesOf([
          { name: 'GetUser', type: 'query', filePath: 'a.gql' },
          { name: 'Dead', type: 'query', filePath: 'a.gql' },
        ]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      mainFunction();

      expect(logged()).toContain('Unused GraphQL Operations');
      expect(logged()).not.toContain('Orphaned GraphQL Files');
    });

    it('reports orphaned files in the JSON report and as annotations', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['g/dead.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesOf(
          [{ name: 'Dead', type: 'query', filePath: 'g/dead.gql' }],
          'g/dead.gql',
        ),
      );
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      mainFunction({ json: true, annotate: true });

      const report = JSON.parse(logged());
      expect(report.orphanedFiles).toEqual(['g/dead.gql']);
      expect(report.summary.orphanedFiles).toBe(1);
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        '::warning file=g/dead.gql::Orphaned GraphQL file',
      );
    });

    it('passes gqlFiles, source contents, and fragment patterns to the corpus scan', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\nfragmentUsagePatterns:\n  - "{Name}FragmentDoc"\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(entitiesOf([]));
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'source' },
      ]);

      expect(() => mainFunction()).not.toThrow();
      expect(mockedUnusedFragments).toHaveBeenCalledWith(
        [entitiesOf([])],
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
      mockedExtract.mockReturnValue(
        entitiesOf([
          { name: 'GetUser', type: 'query', filePath: 'a.gql', line: 1 },
          { name: 'Unused', type: 'query', filePath: 'a.gql', line: 2 },
        ]),
      );
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
      // stdout stays pure JSON: no human-readable reminder leaks into it.
      expect(out).not.toContain(CANDIDATE_REMINDER);
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
        orphanedFiles: 0,
        deprecatedUsages: 0,
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
      mockedExtract.mockReturnValue(
        entitiesOf([
          { name: 'GetUser', type: 'query', filePath: 'a.gql', line: 1 },
        ]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      expect(() => mainFunction({ json: true })).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
      const report = JSON.parse(logged());
      expect(report.summary).toEqual({
        unusedOperations: 0,
        unusedFragments: 0,
        orphanedFiles: 0,
        deprecatedUsages: 0,
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
      mockedExtract.mockReturnValue(
        entitiesOf([
          { name: 'Dead', type: 'query', filePath: 'a.gql', line: 4 },
        ]),
      );
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
        type: 'query' as const,
        filePath: 'a.gql',
        line: 1,
      }));
      mockedFind
        .mockReturnValueOnce(['a.gql']) // gql files
        .mockReturnValueOnce(['src/gql/graphql.ts']); // source files
      mockedExtract.mockReturnValue(entitiesOf(ops));
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
        type: 'query' as const,
        filePath: 'a.gql',
        line: 1,
      }));
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['src/gql/graphql.ts']);
      mockedExtract.mockReturnValue(entitiesOf(ops));
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
      mockedExtract.mockReturnValue(
        entitiesOf([
          { name: 'GetUser', type: 'query', filePath: 'a.gql' },
          { name: 'Dead', type: 'query', filePath: 'a.gql' },
        ]),
      );
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
      mockedExtract.mockReturnValue(
        entitiesOf([
          { name: 'GetUser', type: 'query', filePath: 'a.gql', line: 1 },
        ]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      mainFunction({ json: true, verbose: true });

      // stdout parses as JSON on its own…
      const report = JSON.parse(logged());
      expect(report.summary).toEqual({
        unusedOperations: 0,
        unusedFragments: 0,
        orphanedFiles: 0,
        deprecatedUsages: 0,
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
      mockedExtract.mockReturnValue(
        entitiesOf([{ name: 'GetUser', type: 'query', filePath: 'a.gql' }]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      mainFunction();

      expect(errorSpy.mock.calls.flat().join('\n')).not.toContain(
        'found in App.tsx',
      );
    });

    it('reports duplicate-name warnings on stderr and in the JSON warnings array', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql', 'b.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesOf([{ name: 'GetUser', type: 'query', filePath: 'a.gql' }]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      mainFunction({ json: true });

      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain('"GetUser"');

      const report = JSON.parse(logged());
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0]).toContain('"GetUser"');
    });

    it('emits duplicate-name warnings as escaped ::warning annotations in annotate mode', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql', 'b.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesOf([{ name: 'GetUser', type: 'query', filePath: 'a.gql' }]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      mainFunction({ annotate: true });

      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toMatch(/::warning::.*GetUser/);
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
      mockedExtract.mockReturnValue(
        entitiesOf([{ name: 'GetUser', type: 'query', filePath: 'a.gql' }]),
      );
      mockedReadSources.mockReturnValue([
        { file: 'App.tsx', content: 'useGetUserQuery()' },
      ]);

      expect(() =>
        mainFunction({ config: { graphqlDir: './g', srcDir: './s' } }),
      ).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(logged()).toContain('No unused');
    });

    // The opt-in field candidates. Each case parses one query selecting a dead
    // field (avatarUrl) and a live one (id) for a used operation.
    describe('field candidates', () => {
      const setUpScan = (configYaml: string) => {
        (fs.readFileSync as jest.Mock).mockReturnValue(configYaml);
        mockedDirExists.mockReturnValue(true);
        mockedFind
          .mockReturnValueOnce(['a.gql'])
          .mockReturnValueOnce(['App.tsx']);
        mockedExtract.mockReturnValue(
          entitiesWithDocument(
            'a.gql',
            'query GetUser {\n  avatarUrl\n  id\n}',
            [{ name: 'GetUser', type: 'query', filePath: 'a.gql', line: 1 }],
          ),
        );
        mockedReadSources.mockReturnValue([
          {
            file: 'App.tsx',
            content: 'const { id } = useGetUserQuery().data;',
          },
        ]);
      };
      const enabled = 'graphqlDir: ./g\nsrcDir: ./s\ncheckFields: true\n';
      const disabled = 'graphqlDir: ./g\nsrcDir: ./s\n';

      it('prints nothing extra when the option is off', () => {
        setUpScan(disabled);

        mainFunction();

        expect(logged()).not.toContain('Field Candidates');
        expect(logged()).not.toContain('avatarUrl');
        expect(logged()).toContain('No unused');
      });

      it('leaves the JSON report untouched when the option is off', () => {
        setUpScan(disabled);

        mainFunction({ json: true });

        const report = JSON.parse(logged());
        expect(report).not.toHaveProperty('unusedFields');
        expect(report.summary).toEqual({
          unusedOperations: 0,
          unusedFragments: 0,
          orphanedFiles: 0,
          deprecatedUsages: 0,
        });
      });

      it('prints the candidates section with its caveat when the option is on', () => {
        setUpScan(enabled);

        mainFunction();

        const out = logged();
        expect(out).toContain('Unused Field Candidates');
        expect(out).toContain('avatarUrl');
        expect(out).toContain('a.gql:2');
        expect(out).toContain('not proof');
      });

      it('does not change the exit code', () => {
        setUpScan(enabled);

        mainFunction();

        expect(process.exitCode).toBe(0);
      });

      it('leaves the closing reminder off the all-clear path', () => {
        setUpScan(enabled);

        mainFunction();

        // The section carries its own caveat, so the reminder that accompanies
        // findings would only repeat it here.
        expect(logged()).toContain('Unused Field Candidates');
        expect(logged()).not.toContain(CANDIDATE_REMINDER);
      });

      it('prints after the orphaned files and before the closing reminder', () => {
        (fs.readFileSync as jest.Mock).mockReturnValue(enabled);
        mockedDirExists.mockReturnValue(true);
        mockedFind
          .mockReturnValueOnce(['a.gql', 'dead.gql'])
          .mockReturnValueOnce(['App.tsx']);
        mockedExtract
          .mockReturnValueOnce(
            entitiesWithDocument(
              'a.gql',
              'query GetUser {\n  avatarUrl\n  id\n}',
              [{ name: 'GetUser', type: 'query', filePath: 'a.gql', line: 1 }],
            ),
          )
          .mockReturnValueOnce(
            entitiesOf(
              [{ name: 'Dead', type: 'query', filePath: 'dead.gql' }],
              'dead.gql',
            ),
          );
        mockedReadSources.mockReturnValue([
          {
            file: 'App.tsx',
            content: 'const { id } = useGetUserQuery().data;',
          },
        ]);

        mainFunction();

        const out = logged();
        expect(process.exitCode).toBe(1);
        const at = (section: string) => {
          const index = out.indexOf(section);
          expect(index).toBeGreaterThanOrEqual(0);
          return index;
        };
        expect(at('Unused GraphQL Operations')).toBeLessThan(
          at('Orphaned GraphQL Files'),
        );
        expect(at('Orphaned GraphQL Files')).toBeLessThan(
          at('Unused Field Candidates'),
        );
        expect(at('Unused Field Candidates')).toBeLessThan(
          at(CANDIDATE_REMINDER),
        );
      });

      it('serializes the candidates in --json mode', () => {
        setUpScan(enabled);

        mainFunction({ json: true });

        const report = JSON.parse(logged());
        expect(report.unusedFields).toEqual([
          { field: 'avatarUrl', locations: [{ file: 'a.gql', line: 2 }] },
        ]);
        expect(report.summary.unusedFields).toBe(1);
      });

      it('emits one ::warning annotation per candidate in annotate mode', () => {
        setUpScan(enabled);

        mainFunction({ annotate: true });

        expect(errorSpy.mock.calls.flat().join('\n')).toContain(
          '::warning file=a.gql,line=2::Unused GraphQL field candidate "avatarUrl" (name not found in source)',
        );
      });

      it('turns the check on from the --fields flag over a config that omits it', () => {
        setUpScan(disabled);

        mainFunction({ json: true, config: { checkFields: true } });

        const report = JSON.parse(logged());
        expect(report.summary.unusedFields).toBe(1);
      });
    });

    // A directory tree for the glob expansion below: each key is a directory,
    // each value the names of its (directory) children.
    const mockDirTree = (tree: Record<string, string[]>) => {
      (fs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => p,
      );
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) =>
        (tree[p] ?? []).map((name) => ({
          name,
          isDirectory: () => true,
          isSymbolicLink: () => false,
        })),
      );
    };

    it('expands a directory glob and scans the matching directories', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: packages/*/graphql\nsrcDir: ./s\n',
      );
      mockDirTree({
        packages: ['web', 'admin'],
        'packages/web': ['graphql'],
        'packages/admin': ['graphql'],
      });
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['web.gql'])
        .mockReturnValueOnce(['admin.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(entitiesOf([]));
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      mainFunction();

      // scanProject sees literal directories, never the pattern.
      const scanned = mockedFind.mock.calls.map((call) => call[0]);
      expect(scanned).toEqual([
        'packages/web/graphql',
        'packages/admin/graphql',
        './s',
      ]);
      expect(logged()).toContain('No unused');
    });

    it('exits 2 when a directory glob matches nothing', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: packages/*/graphql\nsrcDir: ./s\n',
      );
      mockDirTree({ packages: ['web'], 'packages/web': ['src'] });
      mockedDirExists.mockReturnValue(true);

      expect(() => mainFunction()).toThrow('process.exit:2');
      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain('packages/*/graphql');
      expect(mockedFind).not.toHaveBeenCalled();
    });

    it('does not touch the filesystem for a config without globs', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockDirTree({});
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(entitiesOf([]));
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      mainFunction();

      expect(fs.readdirSync).not.toHaveBeenCalled();
      expect(mockedFind.mock.calls.map((call) => call[0])).toEqual([
        './g',
        './s',
      ]);
    });

    it('reports both the configured pattern and its expansion under --verbose', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: packages/*/graphql\nsrcDir: ./s\n',
      );
      mockDirTree({ packages: ['web'], 'packages/web': ['graphql'] });
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['web.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(entitiesOf([]));
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      mainFunction({ verbose: true });

      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain('graphqlDir: packages/*/graphql');
      expect(errs).toContain('graphqlDir (expanded): packages/web/graphql');
      // srcDir has no glob, so it gets no expansion line.
      expect(errs).not.toContain('srcDir (expanded)');
    });

    // The opt-in SDL check reads two files: the config and the schema.
    const readsConfigAndSchema = (yamlText: string, sdl: string | Error) => {
      (fs.readFileSync as jest.Mock).mockImplementation((file: string) => {
        if (file !== './schema.graphql') return yamlText;
        if (sdl instanceof Error) throw sdl;
        return sdl;
      });
    };
    const scansOneDeprecatedQuery = () => {
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesWithDocument('a.gql', DEPRECATED_QUERY),
      );
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);
    };

    it('skips the deprecated check entirely when no schemaFile is configured', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      scansOneDeprecatedQuery();

      mainFunction({ json: true });

      const report = JSON.parse(logged());
      expect(report.deprecatedUsages).toEqual([]);
      expect(report.summary.deprecatedUsages).toBe(0);
    });

    it('reports deprecated usages in the JSON report when a schemaFile is set', () => {
      readsConfigAndSchema(
        'graphqlDir: ./g\nsrcDir: ./s\nschemaFile: ./schema.graphql\n',
        SDL,
      );
      scansOneDeprecatedQuery();

      mainFunction({ json: true });

      const report = JSON.parse(logged());
      expect(report.deprecatedUsages).toEqual([
        {
          message: 'The field User.nickname is deprecated. use displayName',
          file: 'a.gql',
          line: 3,
        },
      ]);
      expect(report.summary.deprecatedUsages).toBe(1);
    });

    it('prints a deprecated section and stays at exit code 0 when nothing is unused', () => {
      readsConfigAndSchema(
        'graphqlDir: ./g\nsrcDir: ./s\nschemaFile: ./schema.graphql\n',
        SDL,
      );
      scansOneDeprecatedQuery();

      mainFunction();

      expect(process.exitCode).toBe(0);
      expect(exitSpy).not.toHaveBeenCalled();
      const out = logged();
      expect(out).toContain('Deprecated Field Usage');
      expect(out).toContain('a.gql');
      expect(out).toContain('The field User.nickname is deprecated.');
      expect(out).toContain('Found 1 selection of deprecated');
      expect(out).toContain('No unused');
    });

    it('prints the deprecated section last, before the candidates reminder', () => {
      readsConfigAndSchema(
        'graphqlDir: ./g\nsrcDir: ./s\nschemaFile: ./schema.graphql\n',
        SDL,
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      // One unused operation in a file that also selects a deprecated field, so
      // every section of the report appears at once.
      mockedExtract.mockReturnValue({
        ...entitiesWithDocument('a.gql', DEPRECATED_QUERY),
        operations: [{ name: 'GetUser', type: 'query', filePath: 'a.gql' }],
      });
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      mainFunction();

      const lines = logSpy.mock.calls.flat().map(String);
      const at = (needle: string) =>
        lines.findIndex((line) => line.includes(needle));
      expect(at('Unused GraphQL Operations')).toBeGreaterThan(-1);
      expect(at('Unused GraphQL Operations')).toBeLessThan(
        at('Orphaned GraphQL Files'),
      );
      expect(at('Orphaned GraphQL Files')).toBeLessThan(
        at('Deprecated Field Usage'),
      );
      expect(at(CANDIDATE_REMINDER)).toBe(lines.length - 1);
      expect(process.exitCode).toBe(1);
    });

    it('lists every deprecated selection in the section', () => {
      readsConfigAndSchema(
        'graphqlDir: ./g\nsrcDir: ./s\nschemaFile: ./schema.graphql\n',
        SDL,
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesWithDocument(
          'a.gql',
          'query GetUser {\n  user {\n    nickname\n    legacyName\n  }\n}',
        ),
      );
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      mainFunction();

      const out = logged();
      expect(out).toContain('The field User.legacyName is deprecated.');
      expect(out).toContain('Found 2 selections of deprecated');
    });

    it('prints no deprecated section when the schema flags nothing', () => {
      readsConfigAndSchema(
        'graphqlDir: ./g\nsrcDir: ./s\nschemaFile: ./schema.graphql\n',
        SDL,
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesWithDocument(
          'a.gql',
          'query GetUser {\n  user {\n    id\n  }\n}',
        ),
      );
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

      mainFunction();

      expect(logged()).not.toContain('Deprecated Field Usage');
    });

    it('emits a ::warning annotation per deprecated usage', () => {
      readsConfigAndSchema(
        'graphqlDir: ./g\nsrcDir: ./s\nschemaFile: ./schema.graphql\n',
        SDL,
      );
      scansOneDeprecatedQuery();

      mainFunction({ annotate: true });

      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain(
        '::warning file=a.gql,line=3::The field User.nickname is deprecated. use displayName',
      );
    });

    it('logs the resolved schemaFile with --verbose', () => {
      readsConfigAndSchema(
        'graphqlDir: ./g\nsrcDir: ./s\nschemaFile: ./schema.graphql\n',
        SDL,
      );
      scansOneDeprecatedQuery();

      mainFunction({ verbose: true });

      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        'schemaFile: ./schema.graphql',
      );
    });

    it('exits 2 when the schema file cannot be read', () => {
      readsConfigAndSchema(
        'graphqlDir: ./g\nsrcDir: ./s\nschemaFile: ./schema.graphql\n',
        new Error('ENOENT: no such file'),
      );
      mockedDirExists.mockReturnValue(true);

      expect(() => mainFunction()).toThrow('process.exit:2');
      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain(
        'Could not read or parse the GraphQL schema file: ./schema.graphql.',
      );
    });

    it('exits 2 when the schema file is not valid SDL', () => {
      readsConfigAndSchema(
        'graphqlDir: ./g\nsrcDir: ./s\nschemaFile: ./schema.graphql\n',
        'type Query {',
      );
      mockedDirExists.mockReturnValue(true);

      expect(() => mainFunction()).toThrow('process.exit:2');
      // The same message covers both failures: the file is read and parsed in
      // one step, so invalid SDL must not be reported as unreadable.
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        'Could not read or parse the GraphQL schema file: ./schema.graphql.',
      );
    });

    it('exits 2 with guidance when neither a config file nor flags supply dirs', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });

      expect(() => mainFunction()).toThrow('process.exit:2');
      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain('--graphql');
    });
  });
});
