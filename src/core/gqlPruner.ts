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
  readSourceFiles,
  SourceFile,
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
 * Returns the configured fragment usage patterns. Falls back to the defaults
 * only when the option is omitted; an explicit empty array is respected (it
 * disables source-reference detection, leaving spread-graph reachability only).
 */
export function resolveFragmentUsagePatterns(config: GqlPruneConfig): string[] {
  return Array.isArray(config.fragmentUsagePatterns)
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

/** The machine-readable report emitted by `--json`. */
export type JsonReport = {
  unusedOperations: {
    name: string;
    type: string;
    file: string;
    line?: number;
  }[];
  unusedFragments: { name: string; file: string; line?: number }[];
  /** Advisory warnings (e.g. a suspected generated file masking results). */
  warnings: string[];
  summary: { unusedOperations: number; unusedFragments: number };
};

/** Builds the structured report for `--json` output. */
export function buildJsonReport(
  unusedOperations: OperationInfo[],
  unusedFragments: FragmentInfo[],
  warnings: string[] = [],
): JsonReport {
  return {
    unusedOperations: unusedOperations.map((op) => ({
      name: op.name,
      type: op.type,
      file: op.filePath,
      line: op.line,
    })),
    unusedFragments: unusedFragments.map((fragment) => ({
      name: fragment.name,
      file: fragment.filePath,
      line: fragment.line,
    })),
    warnings,
    summary: {
      unusedOperations: unusedOperations.length,
      unusedFragments: unusedFragments.length,
    },
  };
}

/** Escapes a workflow-command message (data after `::`) per GitHub rules. */
function escapeAnnotationMessage(message: string): string {
  return message
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

/**
 * Escapes a workflow-command property value (e.g. `file=`), which additionally
 * requires `:` and `,` to be encoded (e.g. Windows paths like `C:\...`).
 */
function escapeAnnotationProperty(value: string): string {
  return escapeAnnotationMessage(value)
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

/**
 * Formats GitHub Actions `::warning` annotations for the unused operations and
 * fragments, so they surface inline on a PR. Omits the line when unknown.
 */
export function formatAnnotations(
  unusedOperations: OperationInfo[],
  unusedFragments: FragmentInfo[],
): string[] {
  const annotate = (
    file: string,
    line: number | undefined,
    message: string,
  ): string => {
    const escapedFile = escapeAnnotationProperty(file);
    const location = line
      ? `file=${escapedFile},line=${line}`
      : `file=${escapedFile}`;
    return `::warning ${location}::${escapeAnnotationMessage(message)}`;
  };
  return [
    ...unusedOperations.map((op) =>
      annotate(
        op.filePath,
        op.line,
        `Unused GraphQL operation "${op.name}" (${op.type})`,
      ),
    ),
    ...unusedFragments.map((fragment) =>
      annotate(
        fragment.filePath,
        fragment.line,
        `Unused GraphQL fragment "${fragment.name}"`,
      ),
    ),
  ];
}

/**
 * Coverage at or above which a single source file is treated as likely
 * generated/codegen output that references most operations (and would therefore
 * mask unused results). See {@link detectGeneratedFiles}.
 */
export const GENERATED_COVERAGE_THRESHOLD = 0.7;

/**
 * Minimum number of operations before the coverage heuristic applies. Below
 * this, "one file references most operations" is uninformative — a small project
 * legitimately references everything from just a few places.
 */
export const GENERATED_MIN_OPERATIONS = 5;

/** A source file suspected of masking unused results, with the reasons why. */
export type GeneratedFileWarning = {
  file: string;
  /** Fraction (0..1) of all operations this file references. */
  coverage: number;
  matchedOperations: number;
  totalOperations: number;
  /** Why it was flagged: always includes `'coverage'`, plus `'filename'` / `'header'`. */
  reasons: string[];
};

// Basenames GraphQL Code Generator (and similar tools) commonly emit.
const GENERATED_BASENAMES = new Set([
  'graphql.ts',
  'graphql.tsx',
  'graphql.js',
  'gql.ts',
  'gql.tsx',
  'gql.js',
]);

// Markers found in the header of an auto-generated file (matched case-insensitively).
const GENERATED_HEADER_MARKERS = [
  '@generated',
  'eslint-disable',
  'do not edit',
  'do not modify',
  'auto-generated',
  'autogenerated',
  'automatically generated',
  'generated by',
  'code generated',
  'this file was generated',
];

/** Whether a path looks like generated/codegen output by its filename or folder. */
function looksGeneratedFilename(file: string): boolean {
  const segments = file.replace(/\\/g, '/').split('/');
  const base = segments[segments.length - 1] ?? '';
  const parent = segments[segments.length - 2];
  if (/\.generated\./i.test(base)) return true;
  if (GENERATED_BASENAMES.has(base)) return true;
  if (segments.some((s) => s === '__generated__' || s === 'generated')) {
    return true;
  }
  if (
    (parent === 'gql' || parent === 'graphql') &&
    /^index\.[tj]sx?$/.test(base)
  ) {
    return true;
  }
  return false;
}

/** Whether the first few lines of a file carry a generated-by header. */
function looksGeneratedHeader(content: string): boolean {
  const header = content.split('\n').slice(0, 10).join('\n').toLowerCase();
  return GENERATED_HEADER_MARKERS.some((marker) => header.includes(marker));
}

/**
 * Detects source files that likely mask unused results because a single file
 * references most operations — the classic failure mode where GraphQL Code
 * Generator output lives inside `srcDir` un-excluded, so every operation looks
 * "used" and nothing is ever reported unused.
 *
 * The trigger is coverage: a file referencing at least
 * {@link GENERATED_COVERAGE_THRESHOLD} of all operations, and only when there
 * are at least {@link GENERATED_MIN_OPERATIONS}. A generated-looking filename or
 * header never triggers on its own — a generated file that references no
 * operations is harmless — but is reported as a corroborating reason.
 */
export function detectGeneratedFiles(
  sources: SourceFile[],
  operations: OperationInfo[],
  usagePatterns: string[],
): GeneratedFileWarning[] {
  if (operations.length < GENERATED_MIN_OPERATIONS) return [];

  // Build each operation's usage patterns once, then reuse them across files.
  const operationPatterns = operations.map((op) =>
    buildUsagePatterns(op, usagePatterns),
  );

  const warnings: GeneratedFileWarning[] = [];
  for (const { file, content } of sources) {
    const matchedOperations = operationPatterns.filter((patterns) =>
      patterns.some((pattern) => content.includes(pattern)),
    ).length;
    const coverage = matchedOperations / operations.length;
    if (coverage < GENERATED_COVERAGE_THRESHOLD) continue;

    const reasons = ['coverage'];
    if (looksGeneratedFilename(file)) reasons.push('filename');
    if (looksGeneratedHeader(content)) reasons.push('header');
    warnings.push({
      file,
      coverage,
      matchedOperations,
      totalOperations: operations.length,
      reasons,
    });
  }

  // Most-suspicious first.
  return warnings.sort((a, b) => b.coverage - a.coverage);
}

/** Formats human-readable warning lines for suspected generated files. */
export function formatGeneratedFileWarnings(
  warnings: GeneratedFileWarning[],
): string[] {
  return warnings.map((warning) => {
    const percent = Math.round(warning.coverage * 100);
    const generated =
      warning.reasons.includes('filename') || warning.reasons.includes('header')
        ? ' and looks generated'
        : '';
    return (
      `Suspected generated file "${warning.file}" references ${percent}% of all ` +
      `operations (${warning.matchedOperations}/${warning.totalOperations})${generated} — ` +
      `exclude it via "excludedFolders" in gqlPrune.config.yaml or unused results will be unreliable.`
    );
  });
}

export function mainFunction(
  options: { json?: boolean; annotate?: boolean } = {},
) {
  const json = options.json ?? false;
  const annotate = options.annotate ?? false;
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

  if (!json) {
    console.log(
      `Found ${kleur.yellow(gqlFiles.length.toString())} GraphQL files.`,
    );
    console.log(
      `Found ${kleur.yellow(
        allOperations.length.toString(),
      )} GraphQL operations.`,
    );
  }

  const tsFiles = findFilesWithExtension(
    config.srcDir,
    ['.ts', '.tsx', '.js', '.jsx'],
    excludedFolders,
  );
  if (!json) {
    console.log(
      `Found ${kleur.yellow(tsFiles.length.toString())} source files.`,
    );
  }

  // Read every source file once (paired with its path), then test all operations
  // against the cache instead of re-reading each file for every operation.
  const sources = readSourceFiles(tsFiles);
  const fileContents = sources.map((source) => source.content);

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

  // Warn when a single file references most operations (e.g. un-excluded codegen
  // output): it would silently make every operation look "used" and report
  // nothing unused. Emit to stderr so it surfaces in --json mode too without
  // corrupting the JSON on stdout.
  const generatedWarnings = formatGeneratedFileWarnings(
    detectGeneratedFiles(sources, allOperations, usagePatterns),
  );
  for (const line of generatedWarnings) {
    // In CI, surface it as an (escaped) ::warning workflow command like the other
    // annotations; otherwise a coloured stderr line for humans.
    console.error(
      annotate
        ? `::warning::${escapeAnnotationMessage(line)}`
        : kleur.yellow(`⚠ ${line}`),
    );
  }

  // GitHub Actions annotations go to stderr, keeping stdout clean for --json.
  if (annotate) {
    for (const line of formatAnnotations(unusedOperations, unusedFragments)) {
      console.error(line);
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        buildJsonReport(unusedOperations, unusedFragments, generatedWarnings),
        null,
        2,
      ),
    );
    // Use exitCode (not process.exit) so the piped JSON fully flushes first.
    if (unusedOperations.length > 0 || unusedFragments.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

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

  // Use exitCode (not process.exit) so all report output flushes before exit.
  process.exitCode = 1;
}
