import fs from 'fs';
import kleur from 'kleur';
import * as yaml from 'js-yaml';
import path from 'path';
import { OperationInfo } from '../types/OperationInfo.js';
import { FragmentInfo } from '../types/FragmentInfo.js';
import { GqlPruneConfig } from '../types/GqlPruneConfig.js';
import {
  directoryExists,
  findFilesWithExtension,
  isOperationUsedInContents,
  readFileContents,
} from '../utils/fileUtils.js';
import {
  buildUsagePatterns,
  DEFAULT_FRAGMENT_USAGE_PATTERNS,
  DEFAULT_USAGE_PATTERNS,
} from '../utils/usagePatterns.js';
import { extractOperations } from '../utils/operations.js';
import { findUnusedFragmentsInCorpus } from '../utils/fragments.js';

// Folders that are always excluded from traversal, regardless of config.
export const DEFAULT_EXCLUDED_FOLDERS = ['node_modules', '.git'];

/**
 * Normalizes `excludedFolders` (string | string[] | undefined) and adds the
 * folders that are always excluded (`node_modules`, `.git`).
 */
export function resolveExcludedFolders(config: GqlPruneConfig): string[] {
  let excludedFolders: string[] = [];
  if (Array.isArray(config.excludedFolders)) {
    excludedFolders = config.excludedFolders;
  } else if (typeof config.excludedFolders === 'string') {
    excludedFolders = [config.excludedFolders];
  }
  return [...new Set([...excludedFolders, ...DEFAULT_EXCLUDED_FOLDERS])];
}

/**
 * Returns the configured usage patterns, falling back to the defaults when none
 * are provided.
 */
export function resolveUsagePatterns(config: GqlPruneConfig): string[] {
  return Array.isArray(config.usagePatterns) && config.usagePatterns.length > 0
    ? config.usagePatterns
    : DEFAULT_USAGE_PATTERNS;
}

/**
 * Returns the configured fragment usage patterns, falling back to the defaults
 * when none are provided.
 */
export function resolveFragmentUsagePatterns(config: GqlPruneConfig): string[] {
  return Array.isArray(config.fragmentUsagePatterns) &&
    config.fragmentUsagePatterns.length > 0
    ? config.fragmentUsagePatterns
    : DEFAULT_FRAGMENT_USAGE_PATTERNS;
}

/**
 * Returns the operations that are not referenced by any of the file contents,
 * using the given usage patterns.
 */
export function findUnusedOperations(
  operations: OperationInfo[],
  fileContents: string[],
  usagePatterns: string[],
): OperationInfo[] {
  return operations.filter((op) => {
    const patterns = buildUsagePatterns(op, usagePatterns);
    return !isOperationUsedInContents(patterns, fileContents);
  });
}

/** Prints the aligned table of unused operations. */
function reportUnusedOperations(unusedOperations: OperationInfo[]): void {
  const maxTypeLength = Math.max(
    'Type'.length,
    ...unusedOperations.map((op) => op.type.length),
  );
  const maxNameLength = Math.max(
    'Operation'.length,
    ...unusedOperations.map((op) => op.name.length),
  );

  console.log(kleur.blue('\n--- Unused GraphQL Operations ---\n'));
  console.log(
    'Type'.padEnd(maxTypeLength),
    'Operation'.padEnd(maxNameLength),
    'File',
  );
  unusedOperations.forEach((op) => {
    console.log(
      `${kleur.yellow(op.type.padEnd(maxTypeLength))} ${kleur.cyan(
        op.name.padEnd(maxNameLength),
      )} ${kleur.magenta(path.basename(op.filePath))}`,
    );
  });
  console.log(kleur.blue('---------------------------------'));
  console.log(
    kleur.red(
      `Found ${unusedOperations.length} unused GraphQL operations. Please remove them.`,
    ),
  );
}

/** Prints the aligned table of unused fragments. */
function reportUnusedFragments(unusedFragments: FragmentInfo[]): void {
  const maxNameLength = Math.max(
    'Fragment'.length,
    ...unusedFragments.map((fragment) => fragment.name.length),
  );

  console.log(kleur.blue('\n--- Unused GraphQL Fragments ---\n'));
  console.log('Fragment'.padEnd(maxNameLength), 'File');
  unusedFragments.forEach((fragment) => {
    console.log(
      `${kleur.cyan(fragment.name.padEnd(maxNameLength))} ${kleur.magenta(
        path.basename(fragment.filePath),
      )}`,
    );
  });
  console.log(kleur.blue('--------------------------------'));
  console.log(
    kleur.red(
      `Found ${unusedFragments.length} unused GraphQL fragments. Please remove them.`,
    ),
  );
}

export function mainFunction() {
  let config: GqlPruneConfig;

  try {
    const configFile = fs.readFileSync('./gqlPrune.config.yaml', 'utf8');
    config = yaml.load(configFile) as GqlPruneConfig;
  } catch (e) {
    console.error(
      kleur.red(
        'Error reading the config file (gqlPrune.config.yaml). Run "gqlPrune init" to create one.',
      ),
    );
    console.error(e);
    process.exit(1);
  }

  if (!config || !directoryExists(config.graphqlDir || '')) {
    console.error(
      kleur.red(
        `Provided GraphQL directory "${config?.graphqlDir}" does not exist.`,
      ),
    );
    process.exit(1);
  }

  if (!directoryExists(config.srcDir || '')) {
    console.error(
      kleur.red(`Provided source directory "${config.srcDir}" does not exist.`),
    );
    process.exit(1);
  }

  const excludedFolders = resolveExcludedFolders(config);
  const usagePatterns = resolveUsagePatterns(config);
  const fragmentUsagePatterns = resolveFragmentUsagePatterns(config);

  // ---------------- Main Logic ----------------

  const gqlFiles = findFilesWithExtension(
    config.graphqlDir,
    ['.gql', '.graphql'],
    excludedFolders,
  );
  const allOperations: OperationInfo[] = gqlFiles.flatMap(extractOperations);

  console.log(
    `Found ${kleur.yellow(gqlFiles.length.toString())} GraphQL files.`,
  );
  console.log(
    `Found ${kleur.yellow(
      allOperations.length.toString(),
    )} GraphQL operations.`,
  );

  const tsFiles = findFilesWithExtension(
    config.srcDir,
    ['.ts', '.tsx', '.js', '.jsx'],
    excludedFolders,
  );
  console.log(`Found ${kleur.yellow(tsFiles.length.toString())} source files.`);

  // Read every source file once, then test all operations against the cache
  // instead of re-reading each file for every operation.
  const fileContents = readFileContents(tsFiles);

  const unusedOperations = findUnusedOperations(
    allOperations,
    fileContents,
    usagePatterns,
  );
  const unusedFragments = findUnusedFragmentsInCorpus(
    gqlFiles,
    fileContents,
    fragmentUsagePatterns,
  );

  if (unusedOperations.length === 0 && unusedFragments.length === 0) {
    console.log(
      kleur.green('\n✓ No unused GraphQL operations or fragments found.'),
    );
    return;
  }

  if (unusedOperations.length > 0) {
    reportUnusedOperations(unusedOperations);
  }
  if (unusedFragments.length > 0) {
    reportUnusedFragments(unusedFragments);
  }

  process.exit(1);
}
