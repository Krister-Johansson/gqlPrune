// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import checkbox from '@inquirer/checkbox';
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
import {
  CodegenDerivation,
  deriveGqlPruneConfig,
  discoverCodegenConfig,
} from '../utils/codegen.js';
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
  graphqlDir: string | string[],
  srcDir: string | string[],
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

/**
 * Returns the distinct top-level directories the given files live under, sorted
 * and de-duplicated. A file sitting in the project root contributes `.`.
 */
export function topLevelRoots(filePaths: string[]): string[] {
  const roots = filePaths.map((file) => {
    const dir = path.posix.dirname(
      file.replace(/\\/g, '/').replace(/^\.\//, ''),
    );
    return dir === '.' ? '.' : dir.split('/')[0];
  });
  return [...new Set(roots)].sort();
}

/** A detected directory setting: what to suggest, and roots to choose between. */
export interface DirDetection {
  /** The detected directory, config-formatted, or `undefined` when nothing matched. */
  suggestion: string | undefined;
  /**
   * Config-formatted top-level roots worth offering as a checklist. Only filled
   * when detection collapsed to the project root because the files are spread
   * over several roots, which is where a single suggestion is least useful.
   * A file sitting directly in the project root makes `.` one of those roots,
   * and `.` already covers every other one, so the checklist is suppressed and
   * the plain `.` suggestion stands.
   */
  candidates: string[];
}

/** Formats a detected directory for the config (`./`-prefixed, except root). */
function formatDir(dir: string): string {
  return dir === '.' ? '.' : `./${dir}`;
}

/**
 * Turns a set of detected files into a suggestion plus multi-root candidates.
 * When `.` is itself one of the roots (a file sits directly in the project
 * root) it subsumes the others, so no checklist is offered and the plain `.`
 * suggestion stands.
 */
function detectFrom(filePaths: string[]): DirDetection {
  const dir = commonParentDir(filePaths);
  if (dir === undefined) return { suggestion: undefined, candidates: [] };
  const roots = dir === '.' ? topLevelRoots(filePaths) : [];
  return {
    suggestion: formatDir(dir),
    candidates:
      roots.length > 1 && !roots.includes('.') ? roots.map(formatDir) : [],
  };
}

/**
 * Reads the project's GraphQL Code Generator config, when it has one, so `init`
 * can offer its `documents` globs and generated output paths as the answers
 * instead of asking the user to restate them. Returns `undefined` when there is
 * no config, or nothing in it to derive.
 */
export function detectCodegenDefaults(): CodegenDerivation | undefined {
  const lookup = discoverCodegenConfig();
  if (!lookup.found) return undefined;
  const values = dropUnusableSchemaFile(deriveGqlPruneConfig(lookup.config));
  return Object.keys(values).length === 0
    ? undefined
    : { file: lookup.config.file, values };
}

/**
 * Drops a derived `schemaFile` whose path is not on disk.
 *
 * A codegen `schema` is routinely downloaded or generated at build time, and a
 * scan that derives it degrades gracefully: the deprecated-selection check is
 * skipped with a warning. Writing that path into `gqlPrune.config.yaml` makes it
 * the user's own setting, which fails loudly instead (exit code 2), so `init`
 * would hand back a config that cannot run. Checking the file first keeps the
 * generated config runnable, and keeps `init` from announcing a setting it is
 * not going to write.
 */
function dropUnusableSchemaFile(
  values: Partial<GqlPruneConfig>,
): Partial<GqlPruneConfig> {
  if (values.schemaFile === undefined || fs.existsSync(values.schemaFile)) {
    return values;
  }
  const rest = { ...values };
  delete rest.schemaFile;
  return rest;
}

/**
 * The derived settings `init` writes straight into the generated config. The
 * directories go through the prompts first and are written from the answers;
 * these describe how the project's generated code names things, so the user's
 * choice of directory does not change them.
 *
 * Only a setting the derivation actually produced is returned, so the generated
 * YAML never carries an empty or placeholder key.
 *
 * @param {Partial<GqlPruneConfig> | undefined} values - The derived settings.
 * @returns {Partial<GqlPruneConfig>} - The subset to write to the config file.
 */
export function derivedConfigExtras(
  values: Partial<GqlPruneConfig> | undefined,
): Partial<GqlPruneConfig> {
  if (values === undefined) return {};
  return {
    ...(values.usagePatterns === undefined
      ? {}
      : { usagePatterns: values.usagePatterns }),
    ...(values.fragmentUsagePatterns === undefined
      ? {}
      : { fragmentUsagePatterns: values.fragmentUsagePatterns }),
    ...(values.schemaFile === undefined
      ? {}
      : { schemaFile: values.schemaFile }),
    ...(values.inline === undefined ? {} : { inline: values.inline }),
  };
}

/**
 * Turns codegen-derived directories into a {@link DirDetection}, so they take
 * the place of the filesystem heuristics. Several directories become a
 * checklist, exactly as several detected roots do.
 */
export function codegenDirDetection(
  value: string | string[] | undefined,
): DirDetection | undefined {
  const dirs = resolveDirs(value);
  if (dirs.length === 0) return undefined;
  return {
    suggestion: dirs[0],
    candidates: dirs.length > 1 ? dirs : [],
  };
}

/** Suggests a `graphqlDir` from where the `.gql`/`.graphql` files live. */
export function detectGraphqlDirs(): DirDetection {
  return detectFrom(
    findFilesWithExtension('.', ['.gql', '.graphql'], isDetectExcluded),
  );
}

/** Suggests a `srcDir`, preferring a conventional `./src`, then the source root. */
export function detectSrcDirs(): DirDetection {
  if (directoryExists('src')) return { suggestion: './src', candidates: [] };
  return detectFrom(
    findFilesWithExtension(
      '.',
      ['.ts', '.tsx', '.js', '.jsx'],
      isDetectExcluded,
    ),
  );
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

/**
 * Asks for one directory setting. Files spread over several top-level roots get
 * a checklist of those roots (all ticked) rather than a bare `.` default, which
 * would scan the whole project; one tick is stored as a string, several as a
 * list. Everything else, including a checklist left empty, gets the path prompt.
 */
async function askForDir(
  detection: DirDetection,
  messages: { select: string; path: string },
  placeholder: string,
): Promise<string | string[]> {
  if (detection.candidates.length > 0) {
    const selected = await checkbox({
      message: messages.select,
      choices: detection.candidates.map((dir) => ({
        name: dir,
        value: dir,
        checked: true,
      })),
    });
    if (selected.length === 1) return selected[0];
    if (selected.length > 1) return selected;
  }
  return input({
    message: messages.path,
    default: detection.suggestion ?? placeholder,
  });
}

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

  // Prefer what the project's codegen config already states over guessing from
  // the filesystem, and say where the answers came from so they can be checked.
  const codegen = detectCodegenDefaults();
  if (codegen !== undefined) {
    console.log(
      `Found ${codegen.file}; these settings come from it: ${Object.keys(
        codegen.values,
      ).join(', ')}. ` +
        'The directory questions below start from those values; the rest is ' +
        'written to the config as it stands.',
    );
  }

  const graphqlDir = await askForDir(
    codegenDirDetection(codegen?.values.graphqlDir) ?? detectGraphqlDirs(),
    {
      select:
        'GraphQL files were found under several roots. Select the directories to scan:',
      path: 'Enter the path to your GraphQL directory:',
    },
    './path/to/graphql',
  );
  const srcDir = await askForDir(
    codegenDirDetection(codegen?.values.srcDir) ?? detectSrcDirs(),
    {
      select:
        'Source files were found under several roots. Select the directories to scan:',
      path: 'Enter the path to your source directory:',
    },
    './path/to/src',
  );

  // Reuse the generated-file detector so a fresh config excludes any file that
  // would otherwise reference every operation and mask all unused results. It
  // runs on the answers, so a multi-root selection narrows it the same way.
  const detectedExcludes = detectGeneratedExcludes(graphqlDir, srcDir);
  // The codegen config already names its output paths; excluding them is what
  // keeps generated code from making every operation look used.
  const excludeDefaults = [
    ...new Set([...resolveDirs(codegen?.values.exclude), ...detectedExcludes]),
  ];
  if (detectedExcludes.length > 0) {
    console.log(
      `⚠ Detected a likely generated file that references most operations: ${detectedExcludes.join(
        ', ',
      )}\n  Pre-filling it into "exclude" so results aren't masked — edit or clear it if that's not right.`,
    );
  }

  const answers: GqlPruneConfig = {
    graphqlDir,
    srcDir,
    exclude: splitFolders(
      await input({
        message:
          'Files or folders to exclude (comma separated; gitignore-style globs allowed):',
        default: excludeDefaults.join(', '),
      }),
    ),
    // Everything else the codegen config settled. Writing a config that names
    // the directories stops gqlPrune from reading the codegen config on later
    // runs, so a setting left out here is not merely unannounced, it is lost.
    ...derivedConfigExtras(codegen?.values),
  };

  // Write the answers to a configuration file
  fs.writeFileSync(CONFIG_FILE, yaml.dump(answers));
  console.log('Configuration generated successfully!');

  // Show an instant preview of what a real run would find.
  printPreview(answers);
}
