// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as fs from 'fs';
import * as path from 'path';
import confirm from '@inquirer/confirm';
import input from '@inquirer/input';
import {
  commonParentDir,
  detectGeneratedExcludes,
  detectGraphqlDir,
  detectSrcDir,
  generateConfig,
  splitFolders,
} from '../src/core/configGenerator';
import { scanProject } from '../src/core/gqlPruner';

jest.mock('fs');
jest.mock('@inquirer/confirm', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@inquirer/input', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../src/core/gqlPruner', () => ({
  scanProject: jest.fn(),
  resolveDirs: (value: unknown) =>
    Array.isArray(value) ? value : value ? [value] : [],
}));

const mockedScan = scanProject as jest.Mock;
const mockedConfirm = confirm as unknown as jest.Mock;
const mockedInput = input as unknown as jest.Mock;

/** Queues the three `init` prompt answers (graphqlDir, srcDir, exclude). */
function mockInputAnswers(
  graphqlDir: string,
  srcDir: string,
  exclude = '',
): void {
  mockedInput
    .mockResolvedValueOnce(graphqlDir)
    .mockResolvedValueOnce(srcDir)
    .mockResolvedValueOnce(exclude);
}

// Drives findFilesWithExtension / directoryExists by simulating a tree:
// `entries` maps a directory to its child names; `dirs` is the set of paths
// that are directories.
function mockFsTree(
  entries: Record<string, string[]>,
  dirs: Set<string>,
): void {
  (fs.readdirSync as jest.Mock).mockImplementation((p: string) =>
    (entries[p] ?? []).map((name) => ({
      name,
      isDirectory: () => dirs.has(path.join(p, name)),
      isSymbolicLink: () => false,
    })),
  );
  (fs.statSync as jest.Mock).mockImplementation((p: string) => ({
    isDirectory: () => dirs.has(p),
  }));
  (fs.realpathSync as unknown as jest.Mock).mockImplementation(
    (p: string) => p,
  );
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

    it('drops empty entries (e.g. an empty default)', () => {
      expect(splitFolders('')).toEqual([]);
      expect(splitFolders('a, , b')).toEqual(['a', 'b']);
    });
  });

  describe('detectGeneratedExcludes', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns the detected generated file paths when the dirs exist', () => {
      mockFsTree({}, new Set(['./graphql', './src']));
      mockedScan.mockReturnValue({
        generatedFiles: [
          {
            file: 'src/gql/graphql.ts',
            coverage: 1,
            matchedOperations: 5,
            totalOperations: 5,
            reasons: ['coverage', 'filename'],
          },
        ],
      });
      expect(detectGeneratedExcludes('./graphql', './src')).toEqual([
        'src/gql/graphql.ts',
      ]);
    });

    it('returns [] without scanning when a directory is missing', () => {
      mockFsTree({}, new Set(['./graphql'])); // ./src does not exist
      expect(detectGeneratedExcludes('./graphql', './src')).toEqual([]);
      expect(mockedScan).not.toHaveBeenCalled();
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

    it('asks before overwriting an existing config and keeps it when declined', async () => {
      mockFsTree({ '.': [] }, new Set());
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockedConfirm.mockResolvedValueOnce(false);

      await generateConfig();

      expect(mockedConfirm).toHaveBeenCalledTimes(1);
      expect(mockedConfirm.mock.calls[0][0].default).toBe(false);
      expect(mockedInput).not.toHaveBeenCalled(); // confirm only
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(logSpy.mock.calls.flat().join('\n')).toContain('existing');
    });

    it('overwrites an existing config when the user confirms', async () => {
      mockFsTree({ '.': [] }, new Set());
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      mockedConfirm.mockResolvedValueOnce(true);
      mockInputAnswers('./graphql', './src');

      await generateConfig();

      expect(mockedConfirm).toHaveBeenCalledTimes(1);
      expect(mockedInput).toHaveBeenCalledTimes(3);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it('does not ask for confirmation when no config exists', async () => {
      mockFsTree({ '.': [] }, new Set());
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockInputAnswers('./graphql', './src');

      await generateConfig();

      expect(mockedConfirm).not.toHaveBeenCalled(); // straight to the questions
      expect(mockedInput.mock.calls[0][0].message).toContain(
        'GraphQL directory',
      );
    });

    it('prompts the user and writes the answers as YAML', async () => {
      mockFsTree({ '.': [] }, new Set());
      mockInputAnswers('./graphql', './src', 'node_modules');

      await generateConfig();

      expect(mockedInput).toHaveBeenCalledTimes(3);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const [file, contents] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      expect(file).toBe('./gqlPrune.config.yaml');
      expect(contents).toContain('graphqlDir: ./graphql');
      expect(contents).toContain('srcDir: ./src');
      // init now writes the new `exclude` field, not the deprecated alias.
      expect(contents).toContain('exclude:');
      expect(contents).not.toContain('excludedFolders');
      expect(logSpy.mock.calls.flat().join('\n')).toContain(
        'Configuration generated',
      );
    });

    it('offers detected directories as prompt defaults', async () => {
      mockFsTree(
        { '.': ['graphql'], graphql: ['ops.gql'] },
        new Set(['graphql', 'src']),
      );
      mockInputAnswers('./graphql', './src');

      await generateConfig();

      expect(mockedInput.mock.calls[0][0].default).toBe('./graphql');
      expect(mockedInput.mock.calls[1][0].default).toBe('./src');
    });

    it('prints a preview after writing when the directories exist', async () => {
      mockFsTree({ '.': [] }, new Set(['./graphql', './src']));
      mockInputAnswers('./graphql', './src');
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
        generatedFiles: [],
      });

      await generateConfig();

      const out = logSpy.mock.calls.flat().join('\n');
      expect(out).toContain('42');
      expect(out).toContain('12');
      expect(out).toContain('5');
    });

    it('pre-fills the exclude prompt with a detected generated file and warns', async () => {
      mockFsTree(
        { '.': ['graphql'], graphql: ['ops.gql'] },
        new Set(['graphql', 'src', './graphql', './src']),
      );
      mockedScan.mockReturnValue({
        gqlFileCount: 1,
        sourceFileCount: 1,
        operationCount: 5,
        unusedOperations: [],
        unusedFragments: [],
        generatedWarnings: [],
        generatedFiles: [
          {
            file: 'src/gql/graphql.ts',
            coverage: 1,
            matchedOperations: 5,
            totalOperations: 5,
            reasons: ['coverage', 'filename'],
          },
        ],
      });
      mockInputAnswers('./graphql', './src', 'src/gql/graphql.ts');

      await generateConfig();

      expect(mockedInput.mock.calls[2][0].default).toBe('src/gql/graphql.ts');
      expect(logSpy.mock.calls.flat().join('\n')).toContain(
        'src/gql/graphql.ts',
      );
    });
  });
});
