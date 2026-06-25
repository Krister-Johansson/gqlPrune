import * as fs from 'fs';
import inquirer from 'inquirer';
import {
  commonParentDir,
  detectGraphqlDir,
  detectSrcDir,
  generateConfig,
  splitFolders,
} from '../src/core/configGenerator';
import { scanProject } from '../src/core/gqlPruner';

jest.mock('fs');
jest.mock('inquirer', () => ({
  __esModule: true,
  default: { prompt: jest.fn() },
}));
jest.mock('../src/core/gqlPruner', () => ({
  scanProject: jest.fn(),
  resolveDirs: (value: unknown) =>
    Array.isArray(value) ? value : value ? [value] : [],
}));

const mockedScan = scanProject as jest.Mock;

// Drives findFilesWithExtension / directoryExists by simulating a tree:
// `entries` maps a directory to its child names; `dirs` is the set of paths
// that are directories.
function mockFsTree(
  entries: Record<string, string[]>,
  dirs: Set<string>,
): void {
  (fs.readdirSync as jest.Mock).mockImplementation(
    (p: string) => entries[p] ?? [],
  );
  (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
    isDirectory: () => dirs.has(p),
  }));
}

describe('configGenerator', () => {
  describe('splitFolders', () => {
    it('splits and trims a comma-separated list', () => {
      expect(splitFolders('node_modules, dist ,  __generated__')).toEqual([
        'node_modules',
        'dist',
        '__generated__',
      ]);
    });

    it('returns a single-element list for one folder', () => {
      expect(splitFolders('node_modules')).toEqual(['node_modules']);
    });
  });

  describe('commonParentDir', () => {
    it('returns undefined for no files', () => {
      expect(commonParentDir([])).toBeUndefined();
    });

    it('returns the shared directory of co-located files', () => {
      expect(commonParentDir(['graphql/a.gql', 'graphql/b.gql'])).toBe(
        'graphql',
      );
    });

    it('returns the deepest common ancestor', () => {
      expect(commonParentDir(['graphql/q/a.gql', 'graphql/b.gql'])).toBe(
        'graphql',
      );
    });

    it('returns "." when files are scattered across roots', () => {
      expect(commonParentDir(['graphql/a.gql', 'src/b.gql'])).toBe('.');
    });

    it('returns "." for a file in the project root', () => {
      expect(commonParentDir(['a.gql'])).toBe('.');
    });

    it('normalizes Windows separators', () => {
      expect(commonParentDir(['graphql\\a.gql', 'graphql\\b.gql'])).toBe(
        'graphql',
      );
    });
  });

  describe('detectGraphqlDir', () => {
    beforeEach(() => jest.clearAllMocks());

    it('suggests the directory holding .gql files', () => {
      mockFsTree(
        { '.': ['graphql'], graphql: ['ops.gql'] },
        new Set(['graphql']),
      );
      expect(detectGraphqlDir()).toBe('./graphql');
    });

    it('returns undefined when no GraphQL files exist', () => {
      mockFsTree({ '.': [] }, new Set());
      expect(detectGraphqlDir()).toBeUndefined();
    });
  });

  describe('detectSrcDir', () => {
    beforeEach(() => jest.clearAllMocks());

    it('prefers an existing ./src directory', () => {
      mockFsTree({}, new Set(['src']));
      expect(detectSrcDir()).toBe('./src');
    });

    it('returns undefined when there is no src and no source files', () => {
      mockFsTree({ '.': [] }, new Set());
      expect(detectSrcDir()).toBeUndefined();
    });
  });

  describe('generateConfig', () => {
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.clearAllMocks();
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => logSpy.mockRestore());

    it('prompts the user and writes the answers as YAML', async () => {
      mockFsTree({ '.': [] }, new Set());
      (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({
        graphqlDir: './graphql',
        srcDir: './src',
        excludedFolders: ['node_modules'],
      });

      await generateConfig();

      expect(inquirer.prompt).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const [file, contents] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      expect(file).toBe('./gqlPrune.config.yaml');
      expect(contents).toContain('graphqlDir: ./graphql');
      expect(contents).toContain('srcDir: ./src');
      expect(logSpy.mock.calls.flat().join('\n')).toContain(
        'Configuration generated',
      );
    });

    it('offers detected directories as prompt defaults', async () => {
      mockFsTree(
        { '.': ['graphql'], graphql: ['ops.gql'] },
        new Set(['graphql', 'src']),
      );
      (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({
        graphqlDir: './graphql',
        srcDir: './src',
        excludedFolders: ['node_modules'],
      });

      await generateConfig();

      const questions = (inquirer.prompt as unknown as jest.Mock).mock
        .calls[0][0];
      const byName = Object.fromEntries(
        questions.map((q: { name: string }) => [q.name, q]),
      );
      expect(byName.graphqlDir.default).toBe('./graphql');
      expect(byName.srcDir.default).toBe('./src');
    });

    it('prints a preview after writing when the directories exist', async () => {
      mockFsTree({ '.': [] }, new Set(['./graphql', './src']));
      (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({
        graphqlDir: './graphql',
        srcDir: './src',
        excludedFolders: ['node_modules'],
      });
      mockedScan.mockReturnValue({
        gqlFileCount: 12,
        sourceFileCount: 30,
        operationCount: 42,
        unusedOperations: new Array(5).fill({
          name: 'X',
          type: 'query',
          filePath: 'a.gql',
        }),
        unusedFragments: [],
        generatedWarnings: [],
      });

      await generateConfig();

      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).toContain('42');
      expect(out).toContain('12');
      expect(out).toContain('5');
    });
  });
});
