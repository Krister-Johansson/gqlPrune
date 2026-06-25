import inquirer from 'inquirer';
import * as yaml from 'js-yaml';
import fs from 'fs';
import * as path from 'path';
import { directoryExists, findFilesWithExtension } from '../utils/fileUtils.js';
import { resolveDirs, scanProject } from './gqlPruner.js';
import { GqlPruneConfig } from '../types/GqlPruneConfig.js';

// Folders never worth scanning when auto-detecting the project layout.
const DETECT_EXCLUDES = ['node_modules', '.git', 'dist'];

/** Splits a comma-separated input into a trimmed list of folder names. */
export function splitFolders(input: string): string[] {
  return input.split(',').map((folder) => folder.trim());
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
    findFilesWithExtension('.', ['.gql', '.graphql'], DETECT_EXCLUDES),
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
      DETECT_EXCLUDES,
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

export async function generateConfig() {
  const questions = [
    {
      type: 'input',
      name: 'graphqlDir',
      message: 'Enter the path to your GraphQL directory:',
      default: detectGraphqlDir() ?? './path/to/graphql',
    },
    {
      type: 'input',
      name: 'srcDir',
      message: 'Enter the path to your source directory:',
      default: detectSrcDir() ?? './path/to/src',
    },
    {
      type: 'input',
      name: 'excludedFolders',
      message: 'Enter the folders to exclude (comma separated if multiple):',
      default: 'node_modules',
      filter: splitFolders,
    },
  ];

  const answers = await inquirer.prompt(questions);

  // Write the answers to a configuration file
  fs.writeFileSync('./gqlPrune.config.yaml', yaml.dump(answers));
  console.log('Configuration generated successfully!');

  // Level 3: show an instant preview of what a real run would find.
  printPreview(answers as GqlPruneConfig);
}
