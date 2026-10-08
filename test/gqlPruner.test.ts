// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as fs from 'fs';
import { buildSchema, GraphQLSchema, parse, Source } from 'graphql';
import * as fileUtils from '../src/utils/fileUtils';
import { DEFAULT_SOURCE_EXTENSIONS } from '../src/utils/fileUtils';
import { extractGraphqlEntities } from '../src/utils/operations';
import * as fragments from '../src/utils/fragments';
import * as inline from '../src/utils/inline';
import {
  buildJsonReport,
  resolveSourceExtensions,
  CANDIDATE_REMINDER,
  createConfigExcludeMatcher,
  DEFAULT_EXCLUDED_FOLDERS,
  detectGeneratedFiles,
  explainOperationUsage,
  findDuplicateNameWarnings,
  formatAnnotations,
  formatExpandedDirLines,
  formatGeneratedFileWarnings,
  formatVerboseConfidenceLines,
  formatVerboseConfigLines,
  formatVerboseFieldLines,
  formatVerboseScanLines,
  mainFunction,
  resolveCheckFields,
  resolveConfig,
  resolveDirs,
  resolveExcludePatterns,
  resolveFragmentUsagePatterns,
  resolveRunConfig,
  resolveScanDirs,
  resolveUsagePatterns,
  scanProject,
  sectionRule,
  sectionTitle,
} from '../src/core/gqlPruner';
import {
  DEFAULT_FRAGMENT_USAGE_PATTERNS,
  DEFAULT_USAGE_PATTERNS,
} from '../src/utils/usagePatterns';
import { OperationInfo } from '../src/types/OperationInfo';
import { GqlPruneConfig } from '../src/types/GqlPruneConfig';
import { indexOf } from './support';

jest.mock('fs');
// Partial mock: keep the pure helpers (findUsageMatch) real, stub the
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
// The tsconfig lookup goes through the compiler's own file-system host, which
// the fs mock cannot serve; the scan resolves modules with the defaults here.
jest.mock('../src/utils/tsconfig', () => {
  const actual = jest.requireActual('../src/utils/tsconfig');
  return {
    ...actual,
    loadCompilerOptions: jest.fn(() => actual.DEFAULT_COMPILER_OPTIONS),
  };
});
// Real extraction, wrapped so a test can assert the opt-in pass never runs.
jest.mock('../src/utils/inline', () => {
  const actual = jest.requireActual('../src/utils/inline');
  return {
    ...actual,
    extractInlineDocuments: jest.fn(actual.extractInlineDocuments),
  };
});

const mockedDirExists = fileUtils.directoryExists as jest.Mock;
const mockedFind = fileUtils.findFilesWithExtension as jest.Mock;
const mockedReadSources = fileUtils.readSourceFiles as jest.Mock;
const mockedExtract = extractGraphqlEntities as jest.Mock;
const mockedExtractInline = inline.extractInlineDocuments as jest.Mock;

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

// Every candidate finding carries a grade; spread this into a fixture that
// only cares about the rest of the shape.
const HIGH = { confidence: 'high' as const, reason: 'name-absent' as const };
// A name written inside a string (`registry["Unused"]`) grades low: it is not
// a reference, but a lookup built at runtime is plausible.
const LOW = {
  confidence: 'low' as const,
  reason: 'string-mention' as const,
};

/**
 * Presents exactly these files to the config readers; every other path reads as
 * missing. `fs` is fully mocked here, so this is the whole project as far as
 * `resolveRunConfig` is concerned.
 */
function mockProjectFiles(files: Record<string, string>): void {
  (fs.existsSync as unknown as jest.Mock).mockImplementation(
    (file: string) => file in files,
  );
  (fs.readFileSync as jest.Mock).mockImplementation((file: string) => {
    if (file in files) return files[file];
    const error = new Error(`ENOENT: ${file}`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  });
}

// A codegen config of the kind a urql project keeps in its root.
const CODEGEN_TS = [
  'const config = {',
  "  schema: './schema.graphql',",
  "  documents: ['src/**/*.graphql'],",
  '  generates: {',
  "    'src/generated/graphql.ts': { plugins: ['typescript-urql'] },",
  '  },',
  '};',
  'export default config;',
].join('\n');

// A codegen config whose documents live under two roots, one of which a
// checkout may not have.
const CODEGEN_TWO_DIRS = [
  'documents:',
  '  - src/**/*.graphql',
  '  - legacy/**/*.graphql',
].join('\n');

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

  describe('a source file the scan cannot read', () => {
    it('carries the reason through to stderr and the JSON warnings', () => {
      // readSourceFiles reports through a callback rather than printing, so
      // this is what proves the callback is wired all the way to the report.
      // A source file dropped from the corpus makes whatever it uses look
      // unused, which is the finding a reader has to be able to explain.
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['Locked.tsx']);
      mockedExtract.mockReturnValue(entitiesOf([]));
      mockedReadSources.mockImplementation(
        (_files: string[], onReadError?: (message: string) => void) => {
          onReadError?.('Skipped the source file Locked.tsx: EACCES.');
          return [];
        },
      );

      const result = scanProject({ graphqlDir: 'g', srcDir: 's' });

      expect(result.readWarnings).toEqual([
        'Skipped the source file Locked.tsx: EACCES.',
      ]);
      expect(result.sourceFileCount).toBe(0);
    });
  });

  describe('resolveUsagePatterns', () => {
    it('defaults when not provided', () => {
      expect(resolveUsagePatterns({ graphqlDir: 'g', srcDir: 's' })).toEqual(
        DEFAULT_USAGE_PATTERNS,
      );
    });

    it('respects an explicit empty array rather than defaulting', () => {
      // Matches resolveFragmentUsagePatterns, which already honoured an empty
      // list, and gives the codegen client preset a way to say "no pattern
      // applies here" instead of falling through to {Name}Document and
      // matching its own generated output.
      expect(
        resolveUsagePatterns({
          graphqlDir: 'g',
          srcDir: 's',
          usagePatterns: [],
        }),
      ).toEqual([]);
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

  describe('explainOperationUsage', () => {
    const ops: OperationInfo[] = [
      { name: 'GetUser', type: 'query', filePath: 'a.gql' },
      { name: 'Unused', type: 'query', filePath: 'a.gql' },
    ];
    const sources = indexOf({
      'src/App.tsx': 'const r = useGetUserQuery()',
      'src/Other.tsx': 'nothing(here)',
    });

    it('records the pattern, the file and the position for a used operation', () => {
      const [usage] = explainOperationUsage(
        [ops[0]],
        sources,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(usage.operation.name).toBe('GetUser');
      expect(usage.match).toEqual({
        pattern: 'useGetUserQuery',
        file: 'src/App.tsx',
        line: 1,
        column: 11,
        via: [],
      });
    });

    it('records the import chain the reference went through', () => {
      const index = indexOf({
        'src/api/index.ts': "export * from './hooks';",
        'src/api/hooks.ts':
          "export { useGetUserQuery } from '../generated/graphql';",
        'src/App.tsx':
          "import { useGetUserQuery } from './api';\nuseGetUserQuery();",
      });

      const [usage] = explainOperationUsage(
        [ops[0]],
        index,
        DEFAULT_USAGE_PATTERNS,
      );

      expect(usage.match?.file).toBe('src/App.tsx');
      expect(usage.match?.via).toHaveLength(3);
      expect(usage.match?.via[0]).toContain("imported from './api'");
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

    it('returns [] for no operations', () => {
      expect(
        explainOperationUsage([], sources, DEFAULT_USAGE_PATTERNS),
      ).toEqual([]);
    });
  });

  describe('sectionTitle and sectionRule', () => {
    it('frames a section name in dashes', () => {
      expect(sectionTitle('Unused GraphQL Operations')).toBe(
        '--- Unused GraphQL Operations ---',
      );
    });

    it('closes a section with a rule exactly as wide as its title', () => {
      // The rules used to be hand-counted per section, so renaming a section
      // silently broke the alignment. Derived, they cannot drift.
      for (const name of [
        'Unused GraphQL Operations',
        'Unused GraphQL Fragments',
        'Orphaned GraphQL Files',
        'Deprecated Field Usage',
        'Unused Field Candidates',
      ]) {
        expect(sectionRule(name)).toBe('-'.repeat(sectionTitle(name).length));
        expect(sectionRule(name)).toMatch(/^-+$/);
      }
    });
  });

  describe('resolveScanDirs', () => {
    // Only the mocks these cases set are reset: a blanket reset would also
    // wipe the default implementations the module-level mocks were given.
    afterEach(() => {
      (fs.readdirSync as jest.Mock).mockReset();
      (fs.realpathSync as unknown as jest.Mock).mockReset();
      (fs.statSync as jest.Mock).mockReset();
      mockedDirExists.mockReset();
    });

    it('carries a subtree the glob walk could not read as a warning', () => {
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
      (fs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => p,
      );
      (fs.readdirSync as jest.Mock).mockImplementation((p: string) => {
        if (p === 'packages/locked') throw new Error('EACCES');
        const tree: Record<string, string[]> = {
          packages: ['a', 'locked'],
          'packages/a': ['graphql'],
        };
        return (tree[p] ?? []).map((name) => ({
          name,
          isDirectory: () => true,
          isSymbolicLink: () => false,
        }));
      });
      (fileUtils.directoryExists as jest.Mock).mockReturnValue(true);

      const scanDirs = resolveScanDirs(['packages/*/graphql'], ['./src']);

      expect(scanDirs.error).toBeUndefined();
      expect(scanDirs.graphqlDir).toEqual(['packages/a/graphql']);
      expect(scanDirs.warnings).toEqual([
        'Skipped the directory packages/locked: could not read it. EACCES ' +
          'Anything it holds is missing from this scan.',
      ]);
    });

    it('keeps the walk warnings when a glob matches nothing', () => {
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
      (fs.realpathSync as unknown as jest.Mock).mockImplementation(
        (p: string) => p,
      );
      (fs.readdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('EACCES');
      });

      const scanDirs = resolveScanDirs(['locked/*/graphql'], ['./src']);

      expect(scanDirs.error).toContain('match no directories');
      expect(scanDirs.warnings).toHaveLength(1);
      expect(scanDirs.warnings[0]).toContain('Skipped the directory locked');
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

  describe('resolveSourceExtensions', () => {
    it('falls back to the JavaScript and TypeScript module extensions', () => {
      // Written out rather than compared against the constant it returns: that
      // comparison stays green if an extension is dropped, and a dropped
      // extension means every operation used only from those files is reported
      // unused.
      const expected = [
        '.ts',
        '.tsx',
        '.js',
        '.jsx',
        '.mjs',
        '.cjs',
        '.mts',
        '.cts',
      ];

      expect(resolveSourceExtensions()).toEqual(expected);
      expect(resolveSourceExtensions([])).toEqual(expected);
      expect(DEFAULT_SOURCE_EXTENSIONS).toEqual(expected);
    });

    it('normalizes a configured list to lowercase with a leading dot', () => {
      expect(resolveSourceExtensions(['vue', '.SVELTE', ' .ts '])).toEqual([
        '.vue',
        '.svelte',
        '.ts',
      ]);
    });

    it('accepts a single extension written as a scalar', () => {
      expect(resolveSourceExtensions('.vue')).toEqual(['.vue']);
    });
  });

  describe('resolveUsagePatterns', () => {
    it('accepts a single pattern written as a YAML scalar', () => {
      // A scalar used to be discarded in favour of the built-in defaults, so
      // the convention the user configured was never searched for and every
      // operation using it came back unused.
      expect(
        resolveUsagePatterns({
          usagePatterns: '{Name}Doc',
        } as unknown as GqlPruneConfig),
      ).toEqual(['{Name}Doc']);
    });

    it('respects an explicit empty list instead of falling back', () => {
      expect(
        resolveUsagePatterns({
          usagePatterns: [],
        } as unknown as GqlPruneConfig),
      ).toEqual([]);
    });

    it('falls back to the defaults when the key is absent', () => {
      expect(resolveUsagePatterns({} as GqlPruneConfig)).toEqual(
        DEFAULT_USAGE_PATTERNS,
      );
    });

    it('rejects a non-string entry rather than crashing later', () => {
      // A YAML list of ports reached expandPattern as a number, where
      // pattern.replace threw and took the run down with a stack trace.
      expect(() =>
        resolveUsagePatterns({
          usagePatterns: [8080],
        } as unknown as GqlPruneConfig),
      ).toThrow(/Every entry in "usagePatterns"/);
    });
  });

  describe('resolveFragmentUsagePatterns', () => {
    it('names the setting the bad value came from', () => {
      // The shared resolver used to blame usagePatterns whichever key was at
      // fault, sending the user to the wrong line of their config.
      expect(() =>
        resolveFragmentUsagePatterns({
          fragmentUsagePatterns: [7],
        } as unknown as GqlPruneConfig),
      ).toThrow(/Every entry in "fragmentUsagePatterns"/);
    });
  });

  describe('formatVerboseScanLines', () => {
    const baseResult = {
      gqlFileCount: 1,
      sourceFileCount: 3,
      operationCount: 2,
      inline: false,
      inlineDocumentCount: 0,
      inlineSkippedCount: 0,
      gqlFiles: ['graphql/user.gql'],
      unusedOperations: [],
      unusedFragments: [],
      orphanedFiles: [],
      deprecatedUsages: [],
      unusedFieldCandidates: [],
      fieldTraces: [],
      duplicateWarnings: [],
      generatedWarnings: [],
      readWarnings: [],
      generatedFiles: [],
    };

    it('lists the gql files, source count, and one verdict line per operation', () => {
      const lines = formatVerboseScanLines({
        ...baseResult,
        operationUsages: [
          {
            operation: { name: 'GetUser', type: 'query', filePath: 'a.gql' },
            patterns: ['useGetUserQuery'],
            match: {
              pattern: 'useGetUserQuery',
              file: 'src/App.tsx',
              line: 4,
              column: 17,
              via: ["imported from './api' in src/App.tsx"],
            },
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
      expect(text).toContain(
        '"useGetUserQuery" referenced in src/App.tsx:4:17',
      );
      expect(text).toContain("via imported from './api' in src/App.tsx");
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

    it('counts the inline documents only when that pass ran', () => {
      const off = formatVerboseScanLines({
        ...baseResult,
        operationUsages: [],
      });
      expect(off.join('\n')).not.toContain('Inline documents');

      const on = formatVerboseScanLines({
        ...baseResult,
        operationUsages: [],
        inline: true,
        inlineDocumentCount: 4,
        inlineSkippedCount: 1,
      });
      expect(on.join('\n')).toContain(
        'Inline documents: 4 (1 skipped, did not parse)',
      );
    });
  });

  describe('formatVerboseFieldLines', () => {
    it('says how each operation was judged, traced or matched by name', () => {
      expect(
        formatVerboseFieldLines([
          {
            operation: 'GetUser',
            type: 'query',
            file: 'a.gql',
            mode: 'traced',
            callSites: [
              { file: 'src/App.tsx', line: 2, column: 20 },
              { file: 'src/B.tsx', line: 7, column: 3 },
            ],
          },
          {
            operation: 'GetOne',
            type: 'query',
            file: 'a.gql',
            mode: 'traced',
            callSites: [{ file: 'src/C.tsx', line: 1, column: 1 }],
          },
          {
            operation: 'GetFeed',
            type: 'query',
            file: 'a.gql',
            mode: 'fallback',
            fallback: 'no-reference',
            callSites: [],
          },
          {
            operation: 'GetPosts',
            type: 'query',
            file: 'a.gql',
            mode: 'fallback',
            fallback: 'untraceable-reference',
            reference: { file: 'src/App.tsx', line: 5, column: 25 },
            callSites: [],
          },
          {
            operation: 'SaveUser',
            type: 'mutation',
            file: 'a.gql',
            mode: 'fallback',
            fallback: 'mutation',
            callSites: [],
          },
        ]),
      ).toEqual([
        'fields: GetUser (query) traced through 2 call sites: src/App.tsx:2:20, src/B.tsx:7:3',
        'fields: GetOne (query) traced through 1 call site: src/C.tsx:1:1',
        'fields: GetFeed (query) matched by name: nothing references its identifiers',
        'fields: GetPosts (query) matched by name: the reference at src/App.tsx:5:25 is not a call it can trace',
        "fields: SaveUser (mutation) matched by name: a mutation's selection may exist only to update the cache",
      ]);
    });

    it('returns nothing when the check did not run', () => {
      expect(formatVerboseFieldLines([])).toEqual([]);
    });
  });

  describe('formatVerboseConfidenceLines', () => {
    it('explains the grade of every graded kind', () => {
      const lines = formatVerboseConfidenceLines({
        unusedOperations: [
          { name: 'Dead', type: 'query', filePath: 'a.gql', ...HIGH },
        ],
        unusedFragments: [{ name: 'DeadFields', filePath: 'a.gql', ...LOW }],
        orphanedFiles: [{ file: 'a.gql', ...LOW }],
        unusedFieldCandidates: [
          {
            operation: 'GetUser',
            path: 'user.avatarUrl',
            field: 'avatarUrl',
            locations: [{ file: 'a.gql' }],
            confidence: 'medium',
            reason: 'heuristic-cap',
          },
        ],
      });
      expect(lines).toEqual([
        'confidence: operation "Dead" is high (name-absent: the name appears in no scanned source file)',
        'confidence: fragment "DeadFields" is low (string-mention: the name appears inside a string in ordinary source, which may be a reference built at runtime)',
        'confidence: orphaned file "a.gql" is low (string-mention: the name appears inside a string in ordinary source, which may be a reference built at runtime)',
        'confidence: field "user.avatarUrl" of GetUser is medium (heuristic-cap: no call site of the operation could be traced, so the field was matched by name, which cannot see a read through a rename, a spread, or a computed key)',
      ]);
    });

    it('returns nothing when the scan found nothing', () => {
      expect(
        formatVerboseConfidenceLines({
          unusedOperations: [],
          unusedFragments: [],
          orphanedFiles: [],
          unusedFieldCandidates: [],
        }),
      ).toEqual([]);
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
          [{ name: 'A', type: 'query', filePath: 'a.gql', line: 3, ...HIGH }],
          [{ name: 'F', filePath: 'b.gql', line: 7, ...LOW }],
        ),
      ).toEqual({
        unusedOperations: [
          {
            name: 'A',
            type: 'query',
            file: 'a.gql',
            line: 3,
            confidence: 'high',
            reason: 'name-absent',
          },
        ],
        unusedFragments: [
          {
            name: 'F',
            file: 'b.gql',
            line: 7,
            confidence: 'low',
            reason: 'string-mention',
          },
        ],
        orphanedFiles: [],
        deprecatedUsages: [],
        warnings: [],
        summary: {
          unusedOperations: 1,
          unusedFragments: 1,
          orphanedFiles: 0,
          deprecatedUsages: 0,
          byConfidence: { high: 1, medium: 0, low: 1 },
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
          byConfidence: { high: 0, medium: 0, low: 0 },
        },
      });
    });

    it('counts every graded kind in the confidence breakdown', () => {
      const report = buildJsonReport(
        [{ name: 'A', type: 'query', filePath: 'a.gql', ...HIGH }],
        [{ name: 'F', filePath: 'a.gql', ...LOW }],
        [],
        [{ file: 'a.gql', ...LOW }],
        [],
        [
          {
            operation: 'GetUser',
            path: 'avatarUrl',
            field: 'avatarUrl',
            locations: [{ file: 'a.gql' }],
            confidence: 'medium',
            reason: 'heuristic-cap',
          },
        ],
      );
      expect(report.summary.byConfidence).toEqual({
        high: 1,
        medium: 1,
        low: 2,
      });
    });

    it('includes provided warnings verbatim', () => {
      expect(buildJsonReport([], [], ['heads up']).warnings).toEqual([
        'heads up',
      ]);
    });

    it('lists the orphaned files with their grade and counts them', () => {
      const report = buildJsonReport(
        [{ name: 'A', type: 'query', filePath: 'dead.gql', ...HIGH }],
        [],
        [],
        [{ file: 'dead.gql', ...HIGH }],
      );
      expect(report.orphanedFiles).toEqual([
        { file: 'dead.gql', confidence: 'high', reason: 'name-absent' },
      ]);
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
      // Validated against a real schema, so they are facts rather than
      // candidates: no confidence field, and nothing in the breakdown.
      expect(report.deprecatedUsages).toEqual([
        {
          message: 'The field User.nickname is deprecated. use displayName',
          file: 'graphql/user.gql',
          line: 3,
        },
      ]);
      expect(report.deprecatedUsages[0]).not.toHaveProperty('confidence');
      expect(report.summary.deprecatedUsages).toBe(1);
      expect(report.summary.byConfidence).toEqual({
        high: 0,
        medium: 0,
        low: 0,
      });
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
        [
          {
            operation: 'GetUser',
            path: 'user.avatarUrl',
            field: 'avatarUrl',
            locations: [{ file: 'a.gql', line: 4 }],
            confidence: 'high',
            reason: 'never-read',
          },
        ],
      );
      expect(report.unusedFields).toEqual([
        {
          operation: 'GetUser',
          path: 'user.avatarUrl',
          field: 'avatarUrl',
          locations: [{ file: 'a.gql', line: 4 }],
          confidence: 'high',
          reason: 'never-read',
        },
      ]);
      expect(report.summary).toEqual({
        unusedOperations: 0,
        unusedFragments: 0,
        orphanedFiles: 0,
        deprecatedUsages: 0,
        unusedFields: 1,
        byConfidence: { high: 1, medium: 0, low: 0 },
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
              ...HIGH,
            },
          ],
          [
            {
              name: 'UserFields',
              filePath: 'graphql/user.gql',
              line: 8,
              ...LOW,
            },
          ],
        ),
      ).toEqual([
        '::warning file=graphql/user.gql,line=3::Unused GraphQL operation "GetUser" (query) [confidence: high]',
        '::warning file=graphql/user.gql,line=8::Unused GraphQL fragment "UserFields" [confidence: low]',
      ]);
    });

    it('omits the line property when no line is available', () => {
      expect(
        formatAnnotations(
          [{ name: 'X', type: 'query', filePath: 'a.gql', ...HIGH }],
          [],
        ),
      ).toEqual([
        '::warning file=a.gql::Unused GraphQL operation "X" (query) [confidence: high]',
      ]);
    });

    it('escapes : and , in the file property (e.g. Windows paths)', () => {
      expect(
        formatAnnotations(
          [
            {
              name: 'X',
              type: 'query',
              filePath: 'C:\\a,b\\q.gql',
              line: 1,
              ...HIGH,
            },
          ],
          [],
        ),
      ).toEqual([
        '::warning file=C%3A\\a%2Cb\\q.gql,line=1::Unused GraphQL operation "X" (query) [confidence: high]',
      ]);
    });

    it('annotates an orphaned file without a line', () => {
      expect(
        formatAnnotations([], [], [{ file: 'graphql/dead.gql', ...LOW }]),
      ).toEqual([
        '::warning file=graphql/dead.gql::Orphaned GraphQL file: every definition is unused and no document imports it [confidence: low]',
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
              operation: 'GetUser',
              path: 'user.avatarUrl',
              field: 'avatarUrl',
              locations: [
                { file: 'graphql/user.gql', line: 4 },
                { file: 'graphql/post.gql', line: 9 },
              ],
              confidence: 'high',
              reason: 'never-read',
            },
            {
              operation: 'GetFeed',
              path: 'feed.bio',
              field: 'bio',
              locations: [{ file: 'graphql/feed.gql', line: 3 }],
              confidence: 'medium',
              reason: 'heuristic-cap',
            },
          ],
        ),
      ).toEqual([
        '::warning file=graphql/user.gql,line=4::Unused GraphQL field candidate "user.avatarUrl" in operation "GetUser" (no traced read reaches it) [confidence: high]',
        '::warning file=graphql/feed.gql,line=3::Unused GraphQL field candidate "feed.bio" in operation "GetFeed" (name not found in source) [confidence: medium]',
      ]);
    });

    it('omits the line for a field candidate with no known line', () => {
      expect(
        formatAnnotations(
          [],
          [],
          [],
          [],
          [
            {
              operation: 'GetUser',
              path: 'avatarUrl',
              field: 'avatarUrl',
              locations: [{ file: 'a.gql' }],
              confidence: 'medium',
              reason: 'heuristic-cap',
            },
          ],
        ),
      ).toEqual([
        '::warning file=a.gql::Unused GraphQL field candidate "avatarUrl" in operation "GetUser" (name not found in source) [confidence: medium]',
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
    // A codegen-style file: it declares each hook and references each document
    // constant from inside it, the way real output does. Either alone counts
    // for coverage, since a declaration is what a generated file is made of.
    const docs = (ops: OperationInfo[]): string =>
      ops
        .map(
          (op) =>
            `export const ${op.name}Document = {};\nexport const use${op.name}Query = () => useQuery(${op.name}Document);`,
        )
        .join('\n');
    /** Runs the detection over in-memory sources, indexed the way the scan does. */
    const detect = (
      sources: { file: string; content: string }[],
      ops: OperationInfo[],
      patterns: string[],
    ) =>
      detectGeneratedFiles(
        indexOf(Object.fromEntries(sources.map((s) => [s.file, s.content]))),
        sources,
        ops,
        patterns,
      );

    it('flags a single file that references >= 70% of all operations', () => {
      const ops = makeOps(['GetUser', 'GetPost', 'GetTag', 'GetFoo', 'GetBar']);
      const warnings = detect(
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
      const warnings = detect(
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
      const warnings = detect(
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
      const warnings = detect(
        [{ file: 'src/gql/graphql.ts', content: docs(ops) }],
        ops,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(warnings).toEqual([]);
    });

    it('flags on coverage alone (no generated name or header) at the 70% boundary', () => {
      const ops = makeOps(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
      const warnings = detect(
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
      const warnings = detect(
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
      const [warning] = detect(
        [{ file: 'src/api/__generated__/types.ts', content: docs(ops) }],
        ops,
        DEFAULT_USAGE_PATTERNS,
      );
      expect(warning.reasons).toContain('filename');
    });

    it('recognizes a gql/index.ts barrel file', () => {
      const ops = makeOps(['A', 'B', 'C', 'D', 'E']);
      const [warning] = detect(
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

  describe('resolveRunConfig', () => {
    it('derives the whole configuration when nothing else supplies it', () => {
      mockProjectFiles({ 'codegen.ts': CODEGEN_TS });
      const run = resolveRunConfig();
      expect(run.config).toEqual({
        graphqlDir: ['src'],
        srcDir: ['src'],
        exclude: ['src/generated/graphql.ts'],
        schemaFile: './schema.graphql',
        usagePatterns: ['use{Name}{Type}', '{Name}Document'],
        fragmentUsagePatterns: ['{Name}FragmentDoc'],
      });
      expect(run.codegen?.file).toBe('codegen.ts');
      expect(run.codegenError).toBeUndefined();
    });

    it('never looks at a codegen config when flags supply the directories', () => {
      mockProjectFiles({ 'codegen.ts': CODEGEN_TS });
      const run = resolveRunConfig({ graphqlDir: './g', srcDir: './s' });
      expect(run.config).toEqual({ graphqlDir: './g', srcDir: './s' });
      expect(run.codegen).toBeUndefined();
    });

    it('never looks at a codegen config when the YAML supplies the directories', () => {
      mockProjectFiles({
        './gqlPrune.config.yaml': 'graphqlDir: ./g\nsrcDir: ./s\n',
        'codegen.ts': CODEGEN_TS,
      });
      const run = resolveRunConfig();
      expect(run.config).toEqual({ graphqlDir: './g', srcDir: './s' });
      expect(run.codegen).toBeUndefined();
    });

    it('lets gqlPrune.config.yaml win over an explicitly named codegen config', () => {
      mockProjectFiles({
        './gqlPrune.config.yaml': [
          'codegenConfig: tools/codegen.yml',
          'graphqlDir: ./g',
          'srcDir: ./s',
          'schemaFile: ./mine.graphql',
        ].join('\n'),
        'tools/codegen.yml': [
          'schema: ./theirs.graphql',
          'documents: src/**/*.tsx',
          'generates:',
          '  src/gql/:',
          '    preset: client',
        ].join('\n'),
      });
      const run = resolveRunConfig();
      // The YAML keeps every field it states; only the rest is derived.
      expect(run.config).toMatchObject({
        graphqlDir: './g',
        srcDir: './s',
        schemaFile: './mine.graphql',
        exclude: ['src/gql'],
        inline: true,
      });
      expect(run.codegen).toEqual({
        file: 'tools/codegen.yml',
        values: { exclude: ['src/gql'], inline: true },
      });
    });

    it('lets CLI flags win over both the YAML and the codegen config', () => {
      mockProjectFiles({
        './gqlPrune.config.yaml':
          'codegenConfig: codegen.yml\nsrcDir: ./yaml-s\n',
        'codegen.yml': 'documents: codegen-src/**/*.graphql\n',
      });
      const run = resolveRunConfig({ graphqlDir: './cli-g' });
      expect(run.config).toMatchObject({
        graphqlDir: './cli-g',
        srcDir: './yaml-s',
      });
    });

    it('reports a named codegen config that cannot be read', () => {
      mockProjectFiles({});
      const run = resolveRunConfig({ codegenConfig: 'tools/codegen.yml' });
      expect(run.codegenError).toContain('tools/codegen.yml');
      expect(run.codegen).toBeUndefined();
    });

    it('notes why discovery came back empty instead of failing', () => {
      mockProjectFiles({});
      const run = resolveRunConfig();
      expect(run.codegenError).toBeUndefined();
      expect(run.codegenNotice).toContain('No GraphQL Code Generator config');
      expect(run.config).toEqual({});
    });

    it('notes a discovered config that yields nothing to derive', () => {
      mockProjectFiles({ 'codegen.ts': 'export default { generates: {} };' });
      const run = resolveRunConfig();
      expect(run.codegen).toBeUndefined();
      expect(run.codegenNotice).toContain('codegen.ts');
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
        expect.objectContaining({ byName: expect.any(Map) }), // the reference index
        DEFAULT_FRAGMENT_USAGE_PATTERNS,
        [], // no inline roots: the opt-in inline pass is off
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
        line: 1,
        column: 1,
        via: [],
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

      expect(result.orphanedFiles).toEqual([{ file: 'dead.gql', ...HIGH }]);
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

      // The one call site reads `id` and nothing else.
      expect(result.unusedFieldCandidates).toEqual([
        {
          operation: 'GetUser',
          path: 'avatarUrl',
          field: 'avatarUrl',
          locations: [{ file: 'a.gql', line: 2 }],
          confidence: 'high',
          reason: 'never-read',
        },
      ]);
      expect(result.fieldTraces).toEqual([
        {
          operation: 'GetUser',
          type: 'query',
          file: 'a.gql',
          mode: 'traced',
          callSites: [{ file: 'App.tsx', line: 1, column: 16 }],
        },
      ]);
    });

    it('matches the keys by name when nothing calls the operation', () => {
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract.mockReturnValue(
        entitiesWithDocument('a.gql', 'query GetUser {\n  avatarUrl\n  id\n}', [
          { name: 'GetUser', type: 'query', filePath: 'a.gql' },
        ]),
      );
      mockedReadSources.mockReturnValue([
        {
          file: 'App.tsx',
          content: 'client.query({ query: GetUserDocument, id });',
        },
      ]);

      const result = scanProject({
        graphqlDir: './g',
        srcDir: './s',
        checkFields: true,
      });

      expect(result.unusedFieldCandidates).toEqual([
        {
          operation: 'GetUser',
          path: 'avatarUrl',
          field: 'avatarUrl',
          locations: [{ file: 'a.gql', line: 2 }],
          confidence: 'medium',
          reason: 'heuristic-cap',
        },
      ]);
      expect(result.fieldTraces[0]).toMatchObject({
        mode: 'fallback',
        fallback: 'untraceable-reference',
      });
    });
  });

  describe('scanProject (inline documents)', () => {
    beforeEach(() => jest.clearAllMocks());

    /** Wires the mocks for a scan of one source file and no gql files. */
    const scanSources = (
      sources: { file: string; content: string }[],
      config: Partial<GqlPruneConfig> = {},
      schema?: GraphQLSchema,
    ) => {
      mockedFind
        .mockReturnValueOnce([]) // graphqlDir
        .mockReturnValueOnce(sources.map((source) => source.file)); // srcDir
      mockedReadSources.mockReturnValue(sources);
      return scanProject(
        { graphqlDir: './g', srcDir: './s', ...config },
        schema,
      );
    };

    it('never looks at inline documents by default', () => {
      const result = scanSources([
        {
          file: 'src/App.tsx',
          content: 'const q = gql`query GetUser { id }`;',
        },
      ]);

      expect(mockedExtractInline).not.toHaveBeenCalled();
      expect(result.inline).toBe(false);
      expect(result.inlineDocumentCount).toBe(0);
      expect(result.operationCount).toBe(0);
      expect(result.unusedOperations).toEqual([]);
    });

    it('reports an unused operation from a tagged template with its real line', () => {
      const result = scanSources(
        [
          {
            file: 'src/App.tsx',
            content: '\n\nconst q = gql`\n  query GetUser { id }\n`;',
          },
        ],
        { inline: true },
      );

      expect(result.inline).toBe(true);
      expect(result.inlineDocumentCount).toBe(1);
      expect(result.operationCount).toBe(1);
      expect(result.unusedOperations).toEqual([
        {
          name: 'GetUser',
          type: 'query',
          filePath: 'src/App.tsx',
          line: 4,
          ...HIGH,
        },
      ]);
    });

    it('reports nothing for a document that is commented out', () => {
      const result = scanSources(
        [
          {
            file: 'src/App.tsx',
            content: [
              '// const old = graphql(`query FromComment { me { id } }`);',
              '/* const older = graphql(`query FromBlock { me { id } }`); */',
              'export const note = "graphql(`query FromString { me { id } }`)";',
            ].join('\n'),
          },
        ],
        { inline: true },
      );

      expect(result.inlineDocumentCount).toBe(0);
      expect(result.inlineSkippedCount).toBe(0);
      expect(result.unusedOperations).toEqual([]);
    });

    it('counts a body that does not parse instead of failing the scan', () => {
      const result = scanSources(
        [{ file: 'src/App.tsx', content: 'const q = gql`query {{{`;' }],
        { inline: true },
      );

      expect(result.inlineDocumentCount).toBe(0);
      expect(result.inlineSkippedCount).toBe(1);
      expect(result.unusedOperations).toEqual([]);
    });

    it('treats an inline operation used through a codegen hook as used', () => {
      const result = scanSources(
        [
          {
            file: 'src/queries.ts',
            content: 'const q = graphql(`query GetUser { id }`);',
          },
          { file: 'src/App.tsx', content: 'useGetUserQuery();' },
        ],
        { inline: true },
      );

      expect(result.unusedOperations).toEqual([]);
    });

    it('never counts a document as its own usage', () => {
      // The bare {Name} pattern would match the document's own text if the
      // corpus still carried it.
      const result = scanSources(
        [
          {
            file: 'src/App.tsx',
            content: 'const q = gql`query GetUser { id }`;',
          },
        ],
        { inline: true, usagePatterns: ['{Name}'] },
      );

      expect(result.unusedOperations.map((op) => op.name)).toEqual(['GetUser']);
    });

    it('never counts the defining constant as its own usage', () => {
      // GetUserDocument matches the default {Name}Document pattern, but the only
      // occurrence is the declaration itself.
      const result = scanSources(
        [
          {
            file: 'src/App.tsx',
            content: "const GetUserDocument = graphql('query GetUser { id }');",
          },
        ],
        { inline: true },
      );

      expect(result.unusedOperations.map((op) => op.name)).toEqual(['GetUser']);
    });

    it('treats a document referenced only through its constant as used', () => {
      const result = scanSources(
        [
          {
            file: 'src/queries.ts',
            content:
              "export const userQuery = graphql('query GetUser { id }');",
          },
          // The reference has to resolve to the defining constant, so the
          // consumer imports it; a bare same-named identifier would not do.
          {
            file: 'src/App.tsx',
            content:
              "import { userQuery } from './queries';\nuseQuery(userQuery);",
          },
        ],
        { inline: true },
      );

      expect(result.unusedOperations).toEqual([]);
      expect(result.operationUsages[0].match).toEqual({
        pattern: 'userQuery',
        file: 'src/App.tsx',
        line: 2,
        column: 10,
        via: [],
      });
    });

    it('resolves a fragment defined inline and spread from a gql file', () => {
      mockedUnusedFragments.mockImplementationOnce(
        jest.requireActual('../src/utils/fragments')
          .findUnusedFragmentsInCorpus,
      );
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(['src/fragments.ts']);
      mockedExtract.mockReturnValue({
        ...entitiesWithDocument('a.gql', 'query GetUser { ...UserFields }', [
          { name: 'GetUser', type: 'query', filePath: 'a.gql' },
        ]),
        operationSpreads: ['UserFields'],
      });
      mockedReadSources.mockReturnValue([
        {
          file: 'src/fragments.ts',
          content: 'const f = gql`fragment UserFields on User { id }`;',
        },
      ]);

      const result = scanProject({
        graphqlDir: './g',
        srcDir: './s',
        inline: true,
      });

      expect(result.unusedFragments).toEqual([]);
    });

    it('never names a source file as an orphaned file', () => {
      const result = scanSources(
        [
          {
            file: 'src/App.tsx',
            content: 'const q = gql`query GetUser { id }`;',
          },
        ],
        { inline: true },
      );

      expect(result.unusedOperations).toHaveLength(1);
      expect(result.orphanedFiles).toEqual([]);
    });

    it('checks inline documents against the schema when one is given', () => {
      const result = scanSources(
        [
          {
            file: 'src/App.tsx',
            content:
              'const q = gql`\n  query GetUser {\n    user { nickname }\n  }\n`;',
          },
        ],
        { inline: true },
        buildSchema(SDL),
      );

      expect(result.deprecatedUsages).toEqual([
        {
          message: 'The field User.nickname is deprecated. use displayName',
          file: 'src/App.tsx',
          line: 3,
        },
      ]);
    });

    it('reports field candidates from an inline document', () => {
      const result = scanSources(
        [
          {
            file: 'src/queries.ts',
            content: 'export const q = gql`\n  query GetUser { avatarUrl }\n`;',
          },
          {
            file: 'src/App.tsx',
            content: "import { q } from './queries';\nuseQuery(q);",
          },
        ],
        { inline: true, checkFields: true },
      );

      expect(result.unusedOperations).toEqual([]);
      // The constant is passed to a call whose result nothing reads.
      expect(result.unusedFieldCandidates).toEqual([
        {
          operation: 'GetUser',
          path: 'avatarUrl',
          field: 'avatarUrl',
          locations: [{ file: 'src/queries.ts', line: 2 }],
          confidence: 'high',
          reason: 'never-read',
        },
      ]);
    });
  });

  describe('usage resolved through modules', () => {
    beforeEach(() => jest.clearAllMocks());
    // A scan that throws before discovering files leaves the queued directory
    // listings behind; clearing them keeps the next test's mocks honest.
    afterEach(() => mockedFind.mockReset());

    const GET_USER: OperationInfo = {
      name: 'GetUser',
      type: 'query',
      filePath: 'a.gql',
      line: 1,
    };

    /** Scans one operation against in-memory sources; imports between them resolve. */
    const scan = (
      files: Record<string, string>,
      config: Partial<GqlPruneConfig> = {},
    ) => {
      const sources = Object.entries(files).map(([file, content]) => ({
        file,
        content,
      }));
      mockedFind
        .mockReturnValueOnce(['a.gql'])
        .mockReturnValueOnce(sources.map((source) => source.file));
      mockedExtract.mockReturnValue(entitiesOf([GET_USER]));
      mockedReadSources.mockReturnValue(sources);
      return scanProject({ graphqlDir: './g', srcDir: './s', ...config });
    };
    const unused = (result: ReturnType<typeof scanProject>) =>
      result.unusedOperations.map((op) => [op.name, op.confidence, op.reason]);

    it('treats an operation used only through a re-export as used', () => {
      const result = scan({
        'src/api/docs.ts': "export { GetUserDocument } from '../generated';",
        'src/App.tsx':
          "import { GetUserDocument } from './api/docs';\nuseQuery(GetUserDocument);",
      });

      expect(result.unusedOperations).toEqual([]);
      expect(result.operationUsages[0].match).toMatchObject({
        pattern: 'GetUserDocument',
        file: 'src/App.tsx',
        line: 2,
        column: 10,
      });
    });

    it('follows a barrel index.ts', () => {
      const result = scan({
        'src/api/index.ts': "export * from './hooks';",
        'src/api/hooks.ts': "export { useGetUserQuery } from '../generated';",
        'src/App.tsx':
          "import { useGetUserQuery } from './api';\nuseGetUserQuery();",
      });

      expect(result.unusedOperations).toEqual([]);
      expect(result.operationUsages[0].match?.via).toHaveLength(3);
    });

    it('follows a renamed import', () => {
      const result = scan({
        'src/App.tsx':
          "import { GetUserDocument as Doc } from './generated';\nuseQuery(Doc);",
      });

      expect(result.unusedOperations).toEqual([]);
      expect(result.operationUsages[0].match?.pattern).toBe('GetUserDocument');
    });

    it('follows a default export', () => {
      const result = scan({
        'src/api/userDoc.ts':
          "import { GetUserDocument } from '../generated';\nexport default GetUserDocument;",
        'src/App.tsx':
          "import userDoc from './api/userDoc';\nuseQuery(userDoc);",
      });

      expect(result.unusedOperations).toEqual([]);
    });

    it('follows a namespace import member and an export * chain', () => {
      const result = scan({
        'src/a.ts': "export * from './b';",
        'src/b.ts': "export * from './c';",
        'src/c.ts': "export { GetUserDocument } from '../generated';",
        'src/App.tsx':
          "import * as docs from './a';\nuseQuery(docs.GetUserDocument);",
      });

      expect(result.unusedOperations).toEqual([]);
    });

    it('terminates on a re-export cycle', () => {
      const result = scan({
        'src/a.ts':
          "export * from './b';\nexport { useGetUserQuery } from '../generated';",
        'src/b.ts': "export * from './a';",
        'src/App.tsx':
          "import { useGetUserQuery } from './b';\nuseGetUserQuery();",
      });

      expect(result.unusedOperations).toEqual([]);
    });

    it('keeps the imported name when the specifier cannot be resolved', () => {
      const result = scan({
        'src/App.tsx':
          "import { useGetUserQuery } from '@acme/graphql';\nuseGetUserQuery();",
      });

      expect(result.unusedOperations).toEqual([]);
    });

    it('counts a type-position reference', () => {
      const result = scan(
        {
          'src/thing.service.ts':
            "import { GetUserGQL } from './generated';\nexport class S { constructor(private readonly g: GetUserGQL) {} }",
        },
        { usagePatterns: ['{Name}GQL'] },
      );

      expect(result.unusedOperations).toEqual([]);
    });

    it('counts a property access name', () => {
      const result = scan({
        'src/App.tsx':
          "import { api } from './client';\napi.useGetUserQuery();",
      });

      expect(result.unusedOperations).toEqual([]);
    });

    it('leaves a same-named identifier that is not a reference unused', () => {
      const result = scan({
        'src/App.tsx':
          'const GetUserDocument = 1;\nconst o = { useGetUserQuery: 1 };',
      });

      expect(unused(result)).toEqual([['GetUser', 'high', 'name-absent']]);
    });

    it('does not count an import that is never read', () => {
      const result = scan({
        'src/App.tsx':
          "import { useGetUserQuery } from './generated';\nexport const x = 1;",
      });

      expect(unused(result)).toEqual([['GetUser', 'high', 'name-absent']]);
    });

    it('does not count a comment', () => {
      const result = scan({
        'src/App.tsx':
          '// useGetUserQuery()\n/* GetUserDocument */\nexport {};',
      });

      expect(unused(result)).toEqual([['GetUser', 'high', 'name-absent']]);
    });

    it('does not count a string literal holding the pattern', () => {
      const result = scan({
        'src/App.tsx':
          'export const names = [\'useGetUserQuery\', "GetUserDocument"];',
      });

      expect(unused(result)).toEqual([['GetUser', 'high', 'name-absent']]);
    });

    it('grades an exact string literal of the bare name low', () => {
      const result = scan({
        'src/App.tsx': "export const e = { event: 'GetUser' };",
      });

      expect(unused(result)).toEqual([['GetUser', 'low', 'string-mention']]);
    });

    it('grades a bare-name identifier reference low', () => {
      const result = scan({ 'src/App.tsx': 'track(GetUser);' });

      expect(unused(result)).toEqual([['GetUser', 'low', 'name-referenced']]);
    });

    it('keeps scanning a file that does not parse and warns', () => {
      const result = scan({
        'src/Broken.ts': 'export const n = ;\nuseGetUserQuery();',
      });

      expect(result.unusedOperations).toEqual([]);
      expect(result.readWarnings).toHaveLength(1);
      expect(result.readWarnings[0]).toContain('Broken.ts');
      expect(result.readWarnings[0]).toContain('syntax error');
    });

    it('does not let a local const in another file shadow an import', () => {
      const result = scan({
        'src/other.ts': 'const GetUserDocument = 1;\nexport {};',
        'src/App.tsx':
          "import { GetUserDocument } from './generated';\nuseQuery(GetUserDocument);",
      });

      expect(result.unusedOperations).toEqual([]);
    });

    it('rejects a usage pattern that does not expand to an identifier', () => {
      expect(() =>
        scan({ 'src/App.tsx': '' }, { usagePatterns: ['{Name}.graphql'] }),
      ).toThrow(/expand to an identifier/);
    });

    it('scans a file the parser cannot take by its tokens', () => {
      const result = scan(
        {
          'src/App.vue':
            '<script setup lang="ts">\nconst { data } = useGetUserQuery();\n</script>\n<template>{{ data }}</template>',
        },
        { sourceExtensions: ['.vue'] },
      );

      expect(result.unusedOperations).toEqual([]);
      expect(result.readWarnings).toEqual([]);
      expect(result.operationUsages[0].match).toMatchObject({
        file: 'src/App.vue',
        line: 2,
      });
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
      // One finding reads as one finding, all the way through the sentence.
      expect(logged()).toContain(
        'Found 1 unused GraphQL operation. Please remove it.',
      );
    });

    it('counts every section footer in the plural for more than one', () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(
        'graphqlDir: ./g\nsrcDir: ./s\n',
      );
      mockedDirExists.mockReturnValue(true);
      mockedFind
        .mockReturnValueOnce(['g/dead.gql', 'g/gone.gql'])
        .mockReturnValueOnce(['App.tsx']);
      mockedExtract
        .mockReturnValueOnce(
          entitiesOf(
            [{ name: 'Dead', type: 'query', filePath: 'g/dead.gql' }],
            'g/dead.gql',
          ),
        )
        .mockReturnValueOnce(
          entitiesOf(
            [{ name: 'Gone', type: 'query', filePath: 'g/gone.gql' }],
            'g/gone.gql',
          ),
        );
      mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);
      mockedUnusedFragments.mockReturnValueOnce([
        { name: 'DeadFragment', filePath: 'g/dead.gql' },
        { name: 'GoneFragment', filePath: 'g/gone.gql' },
      ]);

      mainFunction();

      const out = logged();
      expect(out).toContain(
        'Found 2 unused GraphQL operations. Please remove them.',
      );
      expect(out).toContain(
        'Found 2 unused GraphQL fragments. Please remove them.',
      );
      expect(out).toContain(
        'Found 2 orphaned GraphQL files. Every definition in them is unused ' +
          'and no document imports them, so they can likely be deleted.',
      );
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
      expect(logged()).toContain(
        'Found 1 unused GraphQL fragment. Please remove it.',
      );
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
      expect(output).toContain(
        'Found 1 orphaned GraphQL file. Every definition in it is unused and ' +
          'no document imports it, so it can likely be deleted.',
      );
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
      expect(report.orphanedFiles).toEqual([
        { file: 'g/dead.gql', confidence: 'high', reason: 'name-absent' },
      ]);
      expect(report.summary.orphanedFiles).toBe(1);
      expect(errorSpy.mock.calls.flat().join('\n')).toContain(
        '::warning file=g/dead.gql::Orphaned GraphQL file',
      );
    });

    it('passes gqlFiles, the reference index, and fragment patterns to the corpus scan', () => {
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
        expect.objectContaining({ byName: expect.any(Map) }),
        ['{Name}FragmentDoc'],
        [],
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
        {
          name: 'Unused',
          type: 'query',
          file: 'a.gql',
          line: 2,
          confidence: 'high',
          reason: 'name-absent',
        },
      ]);
      expect(report.unusedFragments).toEqual([
        {
          name: 'DeadFrag',
          file: 'a.gql',
          line: 5,
          confidence: 'high',
          reason: 'name-absent',
        },
      ]);
      expect(report.summary).toEqual({
        unusedOperations: 1,
        unusedFragments: 1,
        orphanedFiles: 0,
        deprecatedUsages: 0,
        byConfidence: { high: 2, medium: 0, low: 0 },
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
        byConfidence: { high: 0, medium: 0, low: 0 },
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
      expect(errs).toContain('"useGetUserQuery" referenced in App.tsx');
      expect(errs).toContain('Dead');
      // Verbose lines must never leak to stdout.
      expect(logged()).not.toContain('referenced in App.tsx');
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
        byConfidence: { high: 0, medium: 0, low: 0 },
      });
      // …and the verbose detail went to stderr.
      const errs = errorSpy.mock.calls.flat().join('\n');
      expect(errs).toContain('"useGetUserQuery" referenced in App.tsx');
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
        'referenced in App.tsx',
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
          byConfidence: { high: 0, medium: 0, low: 0 },
        });
      });

      it('prints the candidates section with its caveat when the option is on', () => {
        setUpScan(enabled);

        mainFunction();

        const out = logged();
        expect(out).toContain('Unused Field Candidates');
        expect(out).toContain('avatarUrl');
        expect(out).toContain('a.gql:2');
        expect(out).toContain('GetUser');
        expect(out).toContain(
          'Found 1 field candidate that nothing in the source appears to read.',
        );
        // The caveat says only what is specific to fields; the closing reminder
        // below it carries the shared "verify before deleting" message.
        expect(out).toContain(
          'A high candidate was traced from every call site of its operation, ' +
            'and a value handed to code the trace cannot follow counts as read. ' +
            'A medium candidate was matched by name alone, so a read through a ' +
            'computed key or a spread looks the same as no read, and a common ' +
            'name is never flagged. A field read by another repository looks ' +
            'unread either way.',
        );
        expect(out).not.toContain('before trimming it');
      });

      it('does not change the exit code', () => {
        setUpScan(enabled);

        mainFunction();

        expect(process.exitCode).toBe(0);
      });

      it('closes with the shared reminder even on the all-clear path', () => {
        setUpScan(enabled);

        mainFunction();

        // The section lists candidates, so the line that qualifies candidates
        // belongs under it, whether or not an operation was reported too.
        expect(logged()).toContain('Unused Field Candidates');
        expect(logged()).toContain(CANDIDATE_REMINDER);
        expect(process.exitCode).toBe(0);
      });

      it('prints the reminder once when operations were reported too', () => {
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

        const lines = logSpy.mock.calls.flat().map(String);
        expect(
          lines.filter((line) => line.includes(CANDIDATE_REMINDER)),
        ).toHaveLength(1);
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
          {
            operation: 'GetUser',
            path: 'avatarUrl',
            field: 'avatarUrl',
            locations: [{ file: 'a.gql', line: 2 }],
            confidence: 'high',
            reason: 'never-read',
          },
        ]);
        expect(report.summary.unusedFields).toBe(1);
      });

      it('emits one ::warning annotation per candidate in annotate mode', () => {
        setUpScan(enabled);

        mainFunction({ annotate: true });

        expect(errorSpy.mock.calls.flat().join('\n')).toContain(
          '::warning file=a.gql,line=2::Unused GraphQL field candidate "avatarUrl" in operation "GetUser" (no traced read reaches it)',
        );
      });

      it('turns the check on from the --fields flag over a config that omits it', () => {
        setUpScan(disabled);

        mainFunction({ json: true, config: { checkFields: true } });

        const report = JSON.parse(logged());
        expect(report.summary.unusedFields).toBe(1);
      });
    });

    describe('inline documents', () => {
      const INLINE_SOURCE = {
        file: 'src/App.tsx',
        content: '\nconst q = gql`query GetUser { id }`;',
      };

      /** Config file text plus a source file holding one inline document. */
      const setUpInlineScan = (configYaml: string) => {
        (fs.readFileSync as jest.Mock).mockReturnValue(configYaml);
        mockedDirExists.mockReturnValue(true);
        mockedFind.mockReturnValueOnce([]).mockReturnValueOnce(['src/App.tsx']);
        mockedReadSources.mockReturnValue([INLINE_SOURCE]);
      };

      it('reports nothing from source files by default', () => {
        setUpInlineScan('graphqlDir: ./g\nsrcDir: ./s\n');

        mainFunction({ json: true });

        const report = JSON.parse(logged());
        expect(report.unusedOperations).toEqual([]);
        expect(process.exitCode).toBe(0);
      });

      it('reports an inline operation with its file and line when enabled in the config', () => {
        setUpInlineScan('graphqlDir: ./g\nsrcDir: ./s\ninline: true\n');

        mainFunction({ json: true });

        const report = JSON.parse(logged());
        expect(report.unusedOperations).toEqual([
          {
            name: 'GetUser',
            type: 'query',
            file: 'src/App.tsx',
            line: 2,
            confidence: 'high',
            reason: 'name-absent',
          },
        ]);
        expect(process.exitCode).toBe(1);
      });

      it('turns the pass on from the --inline flag over a config that omits it', () => {
        setUpInlineScan('graphqlDir: ./g\nsrcDir: ./s\n');

        mainFunction({ json: true, config: { inline: true } });

        expect(JSON.parse(logged()).summary.unusedOperations).toBe(1);
      });

      it('counts the inline documents in the human header only when enabled', () => {
        setUpInlineScan('graphqlDir: ./g\nsrcDir: ./s\ninline: true\n');

        mainFunction();

        expect(logged()).toContain('Found 1 inline GraphQL document.');
      });

      it('leaves the header alone when the pass is off', () => {
        setUpInlineScan('graphqlDir: ./g\nsrcDir: ./s\n');

        mainFunction();

        expect(logged()).not.toContain('inline GraphQL documents');
      });

      it('explains the pass under --verbose', () => {
        setUpInlineScan('graphqlDir: ./g\nsrcDir: ./s\ninline: true\n');

        mainFunction({ verbose: true });

        const stderr = errorSpy.mock.calls.flat().join('\n');
        expect(stderr).toContain('inline: true');
        expect(stderr).toContain(
          'Inline documents: 1 (0 skipped, did not parse)',
        );
      });
    });

    // A directory tree for the glob expansion below: each key is a directory,
    // each value the names of its (directory) children.
    const mockDirTree = (tree: Record<string, string[]>) => {
      // Every directory in the tree is on disk; the glob walk checks its base.
      (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
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
      expect(out).toContain(
        'Found 1 selection of deprecated schema fields or enum values. It is ' +
          'advisory and does not affect the exit code.',
      );
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
      expect(out).toContain(
        'Found 2 selections of deprecated schema fields or enum values. They ' +
          'are advisory and do not affect the exit code.',
      );
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

    describe('with a GraphQL Code Generator config', () => {
      /** A scan of one operation that App.tsx uses through the urql hook. */
      const mockScannedProject = (): void => {
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
      };

      it('runs with no gqlPrune configuration at all', () => {
        mockProjectFiles({
          'codegen.ts': CODEGEN_TS,
          './schema.graphql': 'type Query { user: String }',
        });
        mockScannedProject();

        expect(() => mainFunction()).not.toThrow();
        expect(exitSpy).not.toHaveBeenCalled();
        expect(logged()).toContain('No unused');
      });

      it('says which settings came from the codegen config', () => {
        mockProjectFiles({
          'codegen.ts': CODEGEN_TS,
          './schema.graphql': 'type Query { user: String }',
        });
        mockScannedProject();

        mainFunction();
        expect(logged()).toContain('Using settings derived from codegen.ts');
        expect(logged()).toContain('graphqlDir');
        expect(logged()).toContain('usagePatterns');
      });

      it('says so on stderr in --json mode, keeping stdout pure JSON', () => {
        mockProjectFiles({
          'codegen.ts': CODEGEN_TS,
          './schema.graphql': 'type Query { user: String }',
        });
        mockScannedProject();

        mainFunction({ json: true });

        const out = logged();
        expect(out).not.toContain('Using settings derived from');
        expect(() => JSON.parse(out)).not.toThrow();
        expect(errorSpy.mock.calls.flat().join('\n')).toContain(
          'Using settings derived from codegen.ts',
        );
      });

      it('keeps the notice out of the JSON warnings array', () => {
        mockProjectFiles({
          'codegen.ts': CODEGEN_TS,
          './schema.graphql': 'type Query { user: String }',
        });
        mockScannedProject();

        mainFunction({ json: true });

        // The array is for things a consumer should act on. Where a setting
        // came from is provenance, and belongs on the diagnostic stream.
        expect(JSON.parse(logged()).warnings).toEqual([]);
      });

      it('does not dress the notice up as a ::warning under --annotate', () => {
        mockProjectFiles({
          'codegen.ts': CODEGEN_TS,
          './schema.graphql': 'type Query { user: String }',
        });
        mockScannedProject();

        mainFunction({ json: true, annotate: true });

        const errs = errorSpy.mock.calls.flat().join('\n');
        expect(errs).toContain('Using settings derived from codegen.ts');
        expect(errs).not.toContain('::warning::Using settings derived');
      });

      it('lists every derived value under --verbose', () => {
        mockProjectFiles({
          'codegen.ts': CODEGEN_TS,
          './schema.graphql': 'type Query { user: String }',
        });
        mockScannedProject();

        mainFunction({ verbose: true });
        const errs = errorSpy.mock.calls.flat().join('\n');
        expect(errs).toContain('codegen config: codegen.ts');
        expect(errs).toContain('codegen graphqlDir: src');
        expect(errs).toContain('codegen schemaFile: ./schema.graphql');
      });

      it('leaves a project that has its own config untouched', () => {
        mockProjectFiles({
          './gqlPrune.config.yaml': 'graphqlDir: ./g\nsrcDir: ./s\n',
          'codegen.ts': CODEGEN_TS,
        });
        mockScannedProject();

        mainFunction();
        expect(logged()).not.toContain('derived from');
        expect(mockedFind).toHaveBeenCalledWith(
          './g',
          ['.gql', '.graphql'],
          expect.any(Function),
          expect.any(Set),
          expect.any(Function),
        );
      });

      it('exits 2 when a codegen config named by --codegen cannot be read', () => {
        mockProjectFiles({});

        expect(() =>
          mainFunction({ config: { codegenConfig: 'tools/codegen.yml' } }),
        ).toThrow('process.exit:2');
        expect(errorSpy.mock.calls.flat().join('\n')).toContain(
          'tools/codegen.yml',
        );
      });

      it('still exits 2 when the discovered config yields no directories', () => {
        mockProjectFiles({ 'codegen.ts': 'export default { generates: {} };' });

        expect(() => mainFunction()).toThrow('process.exit:2');
        expect(errorSpy.mock.calls.flat().join('\n')).toContain('--graphql');
      });

      // Explicit configuration fails loudly; inference degrades gracefully. A
      // schema path that is not on disk yet (downloaded or generated at build
      // time) is normal in a codegen config, and must not stop a scan the user
      // never asked to include a schema in.
      describe('a derived setting that does not resolve', () => {
        /** A scan of one operation that nothing references. */
        const mockUnusedOperation = (): void => {
          mockedFind
            .mockReturnValueOnce(['a.gql'])
            .mockReturnValueOnce(['App.tsx']);
          mockedExtract.mockReturnValue(
            entitiesOf([{ name: 'Unused', type: 'query', filePath: 'a.gql' }]),
          );
          mockedReadSources.mockReturnValue([
            { file: 'App.tsx', content: 'nothing(here)' },
          ]);
        };

        it('skips the deprecated check when the derived schema cannot be read', () => {
          // codegen.ts names ./schema.graphql, which this project does not have.
          mockProjectFiles({ 'codegen.ts': CODEGEN_TS });
          mockedDirExists.mockReturnValue(true);
          mockUnusedOperation();

          expect(() => mainFunction()).not.toThrow();
          expect(exitSpy).not.toHaveBeenCalled();
          // The exit code reflects the findings, not the skipped check.
          expect(process.exitCode).toBe(1);
          const errs = errorSpy.mock.calls.flat().join('\n');
          expect(errs).toContain('codegen.ts');
          expect(errs).toContain('./schema.graphql');
        });

        it('carries the skipped-schema warning in the JSON report', () => {
          mockProjectFiles({ 'codegen.ts': CODEGEN_TS });
          mockedDirExists.mockReturnValue(true);
          mockUnusedOperation();

          mainFunction({ json: true });

          const report = JSON.parse(logged());
          expect(report.warnings).toHaveLength(1);
          expect(report.warnings[0]).toContain('codegen.ts');
          expect(report.warnings[0]).toContain('./schema.graphql');
          expect(report.deprecatedUsages).toEqual([]);
        });

        it('still exits 2 when --schema names the same unreadable path', () => {
          mockProjectFiles({ 'codegen.ts': CODEGEN_TS });
          mockedDirExists.mockReturnValue(true);

          expect(() =>
            mainFunction({ config: { schemaFile: './schema.graphql' } }),
          ).toThrow('process.exit:2');
          expect(errorSpy.mock.calls.flat().join('\n')).toContain(
            'Could not read or parse the GraphQL schema file: ./schema.graphql.',
          );
        });

        it('drops a derived directory that does not exist and scans the rest', () => {
          mockProjectFiles({ 'codegen.yml': CODEGEN_TWO_DIRS });
          mockedDirExists.mockImplementation((dir: string) => dir === 'src');
          mockUnusedOperation();

          expect(() => mainFunction()).not.toThrow();
          expect(exitSpy).not.toHaveBeenCalled();
          const errs = errorSpy.mock.calls.flat().join('\n');
          expect(errs).toContain('legacy');
          expect(errs).toContain('codegen.yml');
          expect(mockedFind).toHaveBeenCalledWith(
            'src',
            ['.gql', '.graphql'],
            expect.any(Function),
            expect.any(Set),
            expect.any(Function),
          );
          expect(mockedFind).not.toHaveBeenCalledWith(
            'legacy',
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.anything(),
          );
        });

        it('exits 2 with codegen-aware guidance when no derived directory exists', () => {
          mockProjectFiles({ 'codegen.yml': CODEGEN_TWO_DIRS });
          mockedDirExists.mockReturnValue(false);

          expect(() => mainFunction()).toThrow('process.exit:2');
          const errs = errorSpy.mock.calls.flat().join('\n');
          expect(errs).toContain('codegen.yml');
          expect(errs).toContain('src');
          expect(errs).toContain('legacy');
          expect(errs).toContain('graphqlDir');
          expect(errs).not.toContain(
            'These configured directories do not exist',
          );
        });

        it('prints the walk warnings before a directory error ends the run', () => {
          // A glob base that exists but cannot be read matches nothing. The
          // run stops, and the reason it saw less is the EACCES, which has to
          // reach the user along with the error.
          (fs.readFileSync as jest.Mock).mockReturnValue(
            'graphqlDir: locked/*/graphql\nsrcDir: ./s\n',
          );
          (fs.statSync as jest.Mock).mockReturnValue({
            isDirectory: () => true,
          });
          (fs.realpathSync as unknown as jest.Mock).mockImplementation(
            (p: string) => p,
          );
          (fs.readdirSync as jest.Mock).mockImplementation(() => {
            throw new Error('EACCES');
          });

          expect(() => mainFunction()).toThrow('process.exit:2');
          const errs = errorSpy.mock.calls.flat().join('\n');
          expect(errs).toContain('Skipped the directory locked');
          expect(errs).toContain('EACCES');
          expect(errs.indexOf('Skipped the directory locked')).toBeLessThan(
            errs.indexOf('match no directories'),
          );
        });

        it('keeps the plain message for a directory the user configured', () => {
          (fs.readFileSync as jest.Mock).mockReturnValue(
            'graphqlDir: ./g\nsrcDir: ./s\n',
          );
          mockedDirExists.mockImplementation((dir: string) => dir !== './g');

          expect(() => mainFunction()).toThrow('process.exit:2');
          const errs = errorSpy.mock.calls.flat().join('\n');
          expect(errs).toContain(
            'These configured directories do not exist: ./g.',
          );
          expect(errs).not.toContain('codegen');
        });
      });
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

    describe('confidence grading', () => {
      /** One unused operation, scanned against a single source file. */
      const scansOneUnusedOperation = (
        content: string,
        configYaml = 'graphqlDir: ./g\nsrcDir: ./s\n',
      ) => {
        (fs.readFileSync as jest.Mock).mockReturnValue(configYaml);
        mockedDirExists.mockReturnValue(true);
        mockedFind
          .mockReturnValueOnce(['a.gql'])
          .mockReturnValueOnce(['App.tsx']);
        mockedExtract.mockReturnValue(
          entitiesOf([
            { name: 'Unused', type: 'query', filePath: 'a.gql', line: 1 },
          ]),
        );
        mockedReadSources.mockReturnValue([{ file: 'App.tsx', content }]);
      };

      it('shows the grade as a column in the operations table', () => {
        scansOneUnusedOperation('');

        mainFunction();

        expect(logged()).toContain('Confidence');
        expect(logged()).toMatch(/Unused\s+high\s+a\.gql/);
      });

      it('grades a name mentioned in ordinary source as low', () => {
        // The bare name is there, but no usage pattern matches it.
        scansOneUnusedOperation('const q = registry["Unused"];');

        mainFunction();

        expect(logged()).toMatch(/Unused\s+low\s+a\.gql/);
      });

      it('grades a name mentioned only in a generated file as medium', () => {
        (fs.readFileSync as jest.Mock).mockReturnValue(
          'graphqlDir: ./g\nsrcDir: ./s\n',
        );
        mockedDirExists.mockReturnValue(true);
        mockedFind
          .mockReturnValueOnce(['a.gql'])
          .mockReturnValueOnce(['src/gql/graphql.ts']);
        // Five operations, all but one referenced from the generated file, so
        // the coverage heuristic flags it (see detectGeneratedFiles).
        mockedExtract.mockReturnValue(
          entitiesOf([
            { name: 'A', type: 'query', filePath: 'a.gql' },
            { name: 'B', type: 'query', filePath: 'a.gql' },
            { name: 'C', type: 'query', filePath: 'a.gql' },
            { name: 'D', type: 'query', filePath: 'a.gql' },
            { name: 'Unused', type: 'query', filePath: 'a.gql', line: 1 },
          ]),
        );
        mockedReadSources.mockReturnValue([
          {
            file: 'src/gql/graphql.ts',
            // Four hooks referencing their document constants the way codegen
            // output does (80% coverage, so the file is flagged), and the dead
            // name inside a template body, which counts as a string mention.
            content: [
              ...['A', 'B', 'C', 'D'].map(
                (name) =>
                  `export const ${name}Document = {};\nexport const use${name}Query = () => useQuery(${name}Document);`,
              ),
              'const d = gql`query Unused { id }`;',
            ].join('\n'),
          },
        ]);

        mainFunction({ json: true });

        const report = JSON.parse(logged());
        expect(report.unusedOperations).toEqual([
          {
            name: 'Unused',
            type: 'query',
            file: 'a.gql',
            line: 1,
            confidence: 'medium',
            reason: 'generated-only',
          },
        ]);
      });

      it('carries the grade into the JSON report and its summary', () => {
        scansOneUnusedOperation('');

        mainFunction({ json: true });

        const report = JSON.parse(logged());
        expect(report.unusedOperations[0]).toMatchObject({
          confidence: 'high',
          reason: 'name-absent',
        });
        // The operation and the file it leaves orphaned, both graded.
        expect(report.summary.byConfidence).toEqual({
          high: 2,
          medium: 0,
          low: 0,
        });
      });

      it('names the grade in the annotation message', () => {
        scansOneUnusedOperation('');

        mainFunction({ annotate: true });

        expect(errorSpy.mock.calls.flat().join('\n')).toContain(
          '::warning file=a.gql,line=1::Unused GraphQL operation "Unused" (query) [confidence: high]',
        );
      });

      it('explains every grade with --verbose', () => {
        scansOneUnusedOperation('const q = registry["Unused"];');

        mainFunction({ verbose: true });

        expect(errorSpy.mock.calls.flat().join('\n')).toContain(
          'confidence: operation "Unused" is low (string-mention: the name appears inside a string in ordinary source, which may be a reference built at runtime)',
        );
      });

      it('hides findings below --min-confidence and exits 0 when only those existed', () => {
        scansOneUnusedOperation('const q = registry["Unused"];');

        mainFunction({ config: { minConfidence: 'high' } });

        expect(logged()).not.toContain('Unused GraphQL Operations');
        expect(logged()).toContain('No unused');
        expect(process.exitCode).toBe(0);
      });

      it('keeps a finding that meets the configured minimum', () => {
        scansOneUnusedOperation('');

        mainFunction({ config: { minConfidence: 'high' } });

        expect(logged()).toContain('Unused GraphQL Operations');
        expect(process.exitCode).toBe(1);
      });

      it('drops the hidden findings from the JSON report too', () => {
        scansOneUnusedOperation('const q = registry["Unused"];');

        mainFunction({ json: true, config: { minConfidence: 'medium' } });

        const report = JSON.parse(logged());
        expect(report.unusedOperations).toEqual([]);
        expect(report.summary.unusedOperations).toBe(0);
        expect(report.summary.byConfidence).toEqual({
          high: 0,
          medium: 0,
          low: 0,
        });
        expect(process.exitCode).toBe(0);
      });

      it('reports the configured minimum with --verbose', () => {
        scansOneUnusedOperation('');

        mainFunction({ verbose: true, config: { minConfidence: 'medium' } });

        expect(errorSpy.mock.calls.flat().join('\n')).toContain(
          'minConfidence: medium',
        );
      });

      it('exits 2 when the config file names a level that does not exist', () => {
        scansOneUnusedOperation(
          '',
          'graphqlDir: ./g\nsrcDir: ./s\nminConfidence: certain\n',
        );

        expect(() => mainFunction()).toThrow('process.exit:2');
        expect(errorSpy.mock.calls.flat().join('\n')).toContain(
          'Invalid minConfidence: certain. Expected one of high, medium, low.',
        );
      });

      it('leaves deprecated selections ungraded', () => {
        (fs.readFileSync as jest.Mock).mockImplementation((file: string) =>
          file === './schema.graphql'
            ? SDL
            : 'graphqlDir: ./g\nsrcDir: ./s\nschemaFile: ./schema.graphql\n',
        );
        mockedDirExists.mockReturnValue(true);
        mockedFind
          .mockReturnValueOnce(['a.gql'])
          .mockReturnValueOnce(['App.tsx']);
        mockedExtract.mockReturnValue(
          entitiesWithDocument('a.gql', DEPRECATED_QUERY),
        );
        mockedReadSources.mockReturnValue([{ file: 'App.tsx', content: '' }]);

        mainFunction({ json: true });

        const report = JSON.parse(logged());
        expect(report.deprecatedUsages).toHaveLength(1);
        expect(report.deprecatedUsages[0]).not.toHaveProperty('confidence');
        expect(report.deprecatedUsages[0]).not.toHaveProperty('reason');
      });
    });
  });
});
