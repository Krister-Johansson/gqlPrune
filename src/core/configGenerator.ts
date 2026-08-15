// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import confirm from '@inquirer/confirm';
import input from '@inquirer/input';
import * as yaml from 'js-yaml';
import fs from 'fs';
import * as path from 'path';
import {
  createExcludeMatcher,
  directoryExists,
  findFilesWithExtension,
} from '../utils/fileUtils.js';
import { resolveDirs, scanProject } from './gqlPruner.js';
import { GqlPruneConfig } from '../types/GqlPruneConfig.js';

// Folders never worth scanning when auto-detecting the project layout.
const isDetectExcluded = createExcludeMatcher(['node_modules', '.git', 'dist']);

/** Splits a comma-separated input into a trimmed list, dropping empty entries. */
export function splitFolders(input: string): string[] {
  return input
    .split(',')
    .map((folder) => folder.trim())
    .filter(Boolean);
}

/**
 * Detects source files that would mask unused results (a generated file inside
 * `srcDir` referencing most operations — see {@link detectGeneratedFiles}) so
 * `init` can pre-fill them into `exclude`. Returns their project-root-relative
 * paths, or `[]` when a directory is missing (nothing to scan yet).
 */
export function detectGeneratedExcludes(
  graphqlDir: string,
  srcDir: string,
): string[] {
  const dirs = [...resolveDirs(graphqlDir), ...resolveDirs(srcDir)];
  if (dirs.length === 0 || dirs.some((dir) => !directoryExists(dir))) {
    return [];
  }
  return scanProject({ graphqlDir, srcDir }).generatedFiles.map((warning) =>
    warning.file.replace(/\\/g, '/'),
  );
}

/**
 * Returns the deepest directory that contains all the given file paths, or
 * `undefined` when the list is empty. Files spanning separate roots collapse to
 * the project root (`.`).
 */
export function commonParentDir(filePaths: string[]): string | undefined {
  if (filePaths.length === 0) return undefined;
  const dirs = filePaths.map((file) =>
    path.posix.dirname(file.replace(/\\/g, '/')),
  );
  let common = dirs[0];
  for (const dir of dirs) {
    while (dir !== common && !dir.startsWith(`${common}/`)) {
      const parent = path.posix.dirname(common);
      if (parent === common) return '.';
      common = parent;
    }
  }
  return common;
}

/** Formats a detected directory for the config (`./`-prefixed, except root). */
function formatDir(dir: string): string {
  return dir === '.' ? '.' : `./${dir}`;
}

/** Suggests a `graphqlDir` from where the `.gql`/`.graphql` files live. */
export function detectGraphqlDir(): string | undefined {
  const dir = commonParentDir(
    findFilesWithExtension('.', ['.gql', '.graphql'], isDetectExcluded),
  );
  return dir === undefined ? undefined : formatDir(dir);
}

/** Suggests a `srcDir`, preferring a conventional `./src`, then the source root. */
export function detectSrcDir(): string | undefined {
  if (directoryExists('src')) return './src';
  const dir = commonParentDir(
    findFilesWithExtension(
      '.',
      ['.ts', '.tsx', '.js', '.jsx'],
      isDetectExcluded,
    ),
  );
  return dir === undefined ? undefined : formatDir(dir);
}

/** Prints a one-line preview of what a real run would find, when the dirs exist. */
function printPreview(config: GqlPruneConfig): void {
  const dirs = [
    ...resolveDirs(config.graphqlDir),
    ...resolveDirs(config.srcDir),
  ];
  if (dirs.length === 0 || dirs.some((dir) => !directoryExists(dir))) {
    console.log('Run "gqlprune" to scan for unused GraphQL operations.');
    return;
  }
  const { operationCount, gqlFileCount, unusedOperations, unusedFragments } =
    scanProject(config);
  const unused = unusedOperations.length + unusedFragments.length;
  console.log(
    `✓ Found ${operationCount} operations in ${gqlFileCount} files; ${unused} look unused. Run "gqlprune" to see them.`,
  );
}

const CONFIG_FILE = './gqlPrune.config.yaml';

export async function generateConfig() {
  // Never clobber an existing (possibly hand-tuned) config without asking.
  if (fs.existsSync(CONFIG_FILE)) {
    const overwrite = await confirm({
      message: 'gqlPrune.config.yaml already exists. Overwrite it?',
      default: false,
    });
    if (!overwrite) {
      console.log(
        'Keeping the existing gqlPrune.config.yaml — nothing was changed.',
      );
      return;
    }
  }

  const graphqlDefault = detectGraphqlDir() ?? './path/to/graphql';
  const srcDefault = detectSrcDir() ?? './path/to/src';

  // Reuse the generated-file detector so a fresh config excludes any file that
  // would otherwise reference every operation and mask all unused results.
  const detectedExcludes = detectGeneratedExcludes(graphqlDefault, srcDefault);
  if (detectedExcludes.length > 0) {
    console.log(
      `⚠ Detected a likely generated file that references most operations: ${detectedExcludes.join(
        ', ',
      )}\n  Pre-filling it into "exclude" so results aren't masked — edit or clear it if that's not right.`,
    );
  }

  const answers: GqlPruneConfig = {
    graphqlDir: await input({
      message: 'Enter the path to your GraphQL directory:',
      default: graphqlDefault,
    }),
    srcDir: await input({
      message: 'Enter the path to your source directory:',
      default: srcDefault,
    }),
    exclude: splitFolders(
      await input({
        message:
          'Files or folders to exclude (comma separated; gitignore-style globs allowed):',
        default: detectedExcludes.join(', '),
      }),
    ),
  };

  // Write the answers to a configuration file
  fs.writeFileSync(CONFIG_FILE, yaml.dump(answers));
  console.log('Configuration generated successfully!');

  // Show an instant preview of what a real run would find.
  printPreview(answers);
}
