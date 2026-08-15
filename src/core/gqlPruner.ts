// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import fs from 'fs';
import kleur from 'kleur';
import * as yaml from 'js-yaml';
import path from 'path';
import { OperationInfo } from '../types/OperationInfo.js';
import { FragmentInfo } from '../types/FragmentInfo.js';
import { UnusedFieldInfo } from '../types/UnusedFieldInfo.js';
import { CliConfig, GqlPruneConfig } from '../types/GqlPruneConfig.js';
import {
  createExcludeMatcher,
  directoryExists,
  ExcludeMatcher,
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
import {
  extractGraphqlEntities,
  GraphqlFileEntities,
} from '../utils/operations.js';
import { findUnusedFragmentsInCorpus } from '../utils/fragments.js';
import { findUnusedFieldCandidates } from '../utils/fields.js';
import { findOrphanedFiles } from '../utils/orphans.js';

// Folders that are always excluded from traversal, regardless of config.
export const DEFAULT_EXCLUDED_FOLDERS = ['node_modules', '.git'];

/**
 * Collects every exclude pattern: the `exclude` globs, the deprecated
 * `excludedFolders` (folded into the same matcher), and the always-excluded
 * `node_modules` / `.git`.
 */
export function resolveExcludePatterns(config: GqlPruneConfig): string[] {
  return [
    ...new Set([
      ...resolveDirs(config.exclude),
      ...resolveDirs(config.excludedFolders),
      ...DEFAULT_EXCLUDED_FOLDERS,
    ]),
  ];
}

/**
 * Builds the scan's exclude matcher. The always-excluded folders
 * ({@link DEFAULT_EXCLUDED_FOLDERS}) live in their own matcher, OR-ed with one
 * built from the user's `exclude`/`excludedFolders` patterns — so a `!`
 * negation applies only within the user's own patterns and can never
 * re-include `node_modules` or `.git`, as the docs have always promised.
 */
export function createConfigExcludeMatcher(
  config: GqlPruneConfig,
): ExcludeMatcher {
  const always = createExcludeMatcher(DEFAULT_EXCLUDED_FOLDERS);
  const configured = createExcludeMatcher([
    ...resolveDirs(config.exclude),
    ...resolveDirs(config.excludedFolders),
  ]);
  return (relativePath) => always(relativePath) || configured(relativePath);
}

/**
 * Normalizes a `graphqlDir`/`srcDir` value (`string | string[]`) into a clean
 * list of directories, dropping empty/whitespace entries.
 */
export function resolveDirs(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  // YAML can yield non-string entries (e.g. `- 8080`); drop them rather than
  // crash on `.trim()`.
  return (list as unknown[])
    .filter((dir): dir is string => typeof dir === 'string')
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0);
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
 * Whether the opt-in field-candidate check runs. Strictly boolean `true`, so a
 * stray YAML value never silently enables an advisory scan of every selection.
 */
export function resolveCheckFields(config: GqlPruneConfig): boolean {
  return config.checkFields === true;
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

/** How a single operation's used/unused verdict was reached. */
export type OperationUsage = {
  operation: OperationInfo;
  /** The concrete search strings expanded from the usage patterns. */
  patterns: string[];
  /** The first pattern/file hit; absent when the operation is unused. */
  match?: { pattern: string; file: string };
};

/**
 * Determines, for every operation, whether it is referenced in the sources —
 * and when it is, which expanded pattern matched in which file. The unused set
 * derived from this (`!usage.match`) is identical to `findUnusedOperations`;
 * the extra detail exists so `--verbose` can explain each verdict.
 */
export function explainOperationUsage(
  operations: OperationInfo[],
  sources: SourceFile[],
  usagePatterns: string[],
): OperationUsage[] {
  return operations.map((operation) => {
    const patterns = buildUsagePatterns(operation, usagePatterns);
    for (const { file, content } of sources) {
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          return { operation, patterns, match: { pattern, file } };
        }
      }
    }
    return { operation, patterns };
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

/** Formats one selection location as `file:line`, or just the file. */
function formatFieldLocation(location: {
  file: string;
  line?: number;
}): string {
  return location.line ? `${location.file}:${location.line}` : location.file;
}

/**
 * Prints the advisory table of field candidates: one row per selection, with
 * the key shown on its first row only.
 */
function reportUnusedFieldCandidates(candidates: UnusedFieldInfo[]): void {
  const maxFieldLength = Math.max(
    'Field'.length,
    ...candidates.map((candidate) => candidate.field.length),
  );

  console.log(kleur.blue('\n--- Unused Field Candidates ---\n'));
  console.log('Field'.padEnd(maxFieldLength), 'Selected in');
  candidates.forEach((candidate) => {
    candidate.locations.forEach((location, index) => {
      const label = index === 0 ? candidate.field : '';
      console.log(
        `${kleur.cyan(label.padEnd(maxFieldLength))} ${kleur.magenta(
          formatFieldLocation(location),
        )}`,
      );
    });
  });
  console.log(kleur.blue('-------------------------------'));
  console.log(
    kleur.yellow(
      `Found ${candidates.length} field candidates whose name appears nowhere in the source.`,
    ),
  );
  console.log(
    kleur.dim(
      'These are string-search candidates, not proof: a field renamed while ' +
        'destructuring, spread into props, or read by another repository looks ' +
        'the same, and a field with a common name never reaches this list. ' +
        'Verify each one before trimming it.',
    ),
  );
}
/** Prints the list of orphaned GraphQL files. */
function reportOrphanedFiles(orphanedFiles: string[]): void {
  console.log(kleur.blue('\n--- Orphaned GraphQL Files ---\n'));
  console.log('File');
  orphanedFiles.forEach((file) => console.log(kleur.magenta(file)));
  console.log(kleur.blue('------------------------------'));
  console.log(
    kleur.red(
      `Found ${orphanedFiles.length} orphaned GraphQL files. Every definition in them is unused and no document imports them, so they can likely be deleted.`,
    ),
  );
}

/**
 * Closing line of the human-readable report. Usage is detected by string search,
 * so a finding is a candidate rather than proof: names built dynamically, or
 * referenced outside `srcDir` or from another repository, look unused here.
 */
export const CANDIDATE_REMINDER =
  'These are candidates from a string search. Verify each one before deleting.';

/** The machine-readable report emitted by `--json`. */
export type JsonReport = {
  unusedOperations: {
    name: string;
    type: string;
    file: string;
    line?: number;
  }[];
  unusedFragments: { name: string; file: string; line?: number }[];
  /** Files whose every definition is unused and which nothing imports. */
  orphanedFiles: string[];
  /**
   * Field candidates. Present only when the opt-in check ran, so an absent key
   * means "not checked" rather than "nothing found".
   */
  unusedFields?: UnusedFieldInfo[];
  /** Advisory warnings (e.g. a suspected generated file masking results). */
  warnings: string[];
  summary: {
    unusedOperations: number;
    unusedFragments: number;
    orphanedFiles: number;
    unusedFields?: number;
  };
};

/**
 * Builds the structured report for `--json` output. `unusedFields` is omitted
 * entirely when the opt-in field check did not run. An empty array would claim
 * a clean result the scan never looked for.
 */
export function buildJsonReport(
  unusedOperations: OperationInfo[],
  unusedFragments: FragmentInfo[],
  warnings: string[] = [],
  orphanedFiles: string[] = [],
  unusedFields?: UnusedFieldInfo[],
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
    orphanedFiles,
    ...(unusedFields ? { unusedFields } : {}),
    warnings,
    summary: {
      unusedOperations: unusedOperations.length,
      unusedFragments: unusedFragments.length,
      orphanedFiles: orphanedFiles.length,
      ...(unusedFields ? { unusedFields: unusedFields.length } : {}),
    },
  };
}

/** Escapes a workflow-command message (data after `::`) per GitHub rules. */
export function escapeAnnotationMessage(message: string): string {
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
 * fragments and for each orphaned file, so they surface inline on a PR. Omits
 * the line when unknown. Field candidates get one annotation each, pinned to
 * their first selection.
 */
export function formatAnnotations(
  unusedOperations: OperationInfo[],
  unusedFragments: FragmentInfo[],
  orphanedFiles: string[] = [],
  unusedFields: UnusedFieldInfo[] = [],
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
    ...orphanedFiles.map((file) =>
      annotate(
        file,
        undefined,
        'Orphaned GraphQL file: every definition is unused and no document imports it',
      ),
    ),
    ...unusedFields.map((candidate) =>
      annotate(
        candidate.locations[0].file,
        candidate.locations[0].line,
        `Unused GraphQL field candidate "${candidate.field}" (name not found in source)`,
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
      `add it to "exclude" in gqlPrune.config.yaml or unused results will be unreliable.`
    );
  });
}

/**
 * Advisory warnings for operation/fragment names defined more than once across
 * the parsed corpus. Detection is name-keyed, so duplicate definitions are
 * conflated — every definition shares one used/unused verdict. Returned as
 * data so the caller can route them per the I/O rules (stderr + the JSON
 * `warnings` array), like the generated-file warnings.
 */
export function findDuplicateNameWarnings(
  parsedFiles: GraphqlFileEntities[],
): string[] {
  const duplicates = (
    kind: 'operation' | 'fragment',
    definitions: { name: string; filePath: string }[],
  ): string[] => {
    const filesByName = new Map<string, string[]>();
    for (const { name, filePath } of definitions) {
      filesByName.set(name, [...(filesByName.get(name) ?? []), filePath]);
    }
    return [...filesByName]
      .filter(([, files]) => files.length > 1)
      .map(
        ([name, files]) =>
          `Duplicate ${kind} name "${name}" defined in ${[
            ...new Set(files),
          ].join(
            ', ',
          )} — detection is name-based, so all definitions share one verdict and results for it may be unreliable.`,
      );
  };
  return [
    ...duplicates(
      'operation',
      parsedFiles.flatMap((file) => file.operations),
    ),
    ...duplicates(
      'fragment',
      parsedFiles.flatMap((file) => file.fragments),
    ),
  ];
}

/**
 * Loads configuration from `gqlPrune.config.yaml` (if present) and overlays the
 * values provided as CLI flags, which win per field. A missing config file is
 * fine — the CLI flags may supply everything. Throws on a malformed or
 * otherwise unreadable file so the problem isn't silently ignored.
 */
export function resolveConfig(
  cliConfig: CliConfig = {},
): Partial<GqlPruneConfig> {
  let fileConfig: Partial<GqlPruneConfig> = {};
  let raw: string | undefined;
  try {
    raw = fs.readFileSync('./gqlPrune.config.yaml', 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error; // permissions or similar — surface it rather than hide it
    }
    // No config file: rely entirely on CLI flags.
  }
  // An empty/whitespace-only file is treated as no config (parsing it throws),
  // so CLI flags alone can still drive the run.
  if (raw !== undefined && raw.trim() !== '') {
    fileConfig = (yaml.load(raw) as GqlPruneConfig) ?? {};
  }
  // Required fields may still be absent; mainFunction validates and narrows.
  return { ...fileConfig, ...cliConfig };
}

/** The result of a single project scan, free of any console output. */
export type ScanResult = {
  gqlFileCount: number;
  sourceFileCount: number;
  operationCount: number;
  /** The `.gql`/`.graphql` files that were scanned. */
  gqlFiles: string[];
  /** Per-operation verdicts with the matching pattern/file (see `--verbose`). */
  operationUsages: OperationUsage[];
  unusedOperations: OperationInfo[];
  unusedFragments: FragmentInfo[];
  /** Files whose every definition is unused and which no document imports. */
  orphanedFiles: string[];
  /**
   * Advisory field candidates. Always empty unless `checkFields` is on: the
   * detection does not run at all when the option is off.
   */
  unusedFieldCandidates: UnusedFieldInfo[];
  /** Advisory duplicate-name warnings (operations and fragments). */
  duplicateWarnings: string[];
  generatedWarnings: string[];
  /** Raw suspected-generated files, so callers can act on the paths (e.g.
   * `gqlprune init` pre-filling them into `exclude`), not just the messages. */
  generatedFiles: GeneratedFileWarning[];
};

/** Renders the resolved configuration as `--verbose` lines. */
export function formatVerboseConfigLines(config: GqlPruneConfig): string[] {
  const list = (values: string[]): string => values.join(', ');
  return [
    `graphqlDir: ${list(resolveDirs(config.graphqlDir))}`,
    `srcDir: ${list(resolveDirs(config.srcDir))}`,
    `exclude: ${list(resolveExcludePatterns(config))}`,
    `usagePatterns: ${list(resolveUsagePatterns(config))}`,
    `fragmentUsagePatterns: ${list(resolveFragmentUsagePatterns(config))}`,
  ];
}

/**
 * Renders the scan's findings as `--verbose` lines: the files scanned, then one
 * verdict per operation — with the matching pattern and file for used ones, and
 * the searched-but-unmatched patterns for unused ones.
 */
export function formatVerboseScanLines(result: ScanResult): string[] {
  const lines = [
    `GraphQL files (${result.gqlFiles.length}): ${result.gqlFiles.join(', ')}`,
    `Source files scanned: ${result.sourceFileCount}`,
  ];
  for (const { operation, patterns, match } of result.operationUsages) {
    lines.push(
      match
        ? `used:   ${operation.name} (${operation.type}) — "${match.pattern}" found in ${match.file}`
        : `unused: ${operation.name} (${operation.type}) — no match for ${patterns.join(', ')}`,
    );
  }
  return lines;
}

/**
 * Runs one full scan for the given config and returns the results without
 * printing anything. Shared by `mainFunction` (which presents the results) and
 * `gqlprune init`'s preview, so the preview always reflects the real run.
 */
export function scanProject(config: GqlPruneConfig): ScanResult {
  const isExcluded = createConfigExcludeMatcher(config);
  const usagePatterns = resolveUsagePatterns(config);
  const fragmentUsagePatterns = resolveFragmentUsagePatterns(config);

  // Scan every configured directory and de-duplicate (dirs may overlap/nest).
  const gqlFiles = [
    ...new Set(
      resolveDirs(config.graphqlDir).flatMap((dir) =>
        findFilesWithExtension(dir, ['.gql', '.graphql'], isExcluded),
      ),
    ),
  ];
  // Parse every gql file once; operations and the fragment scan share the result.
  const parsedFiles = gqlFiles.map(extractGraphqlEntities);
  const operations: OperationInfo[] = parsedFiles.flatMap(
    (file) => file.operations,
  );

  const tsFiles = [
    ...new Set(
      resolveDirs(config.srcDir).flatMap((dir) =>
        findFilesWithExtension(dir, ['.ts', '.tsx', '.js', '.jsx'], isExcluded),
      ),
    ),
  ];
  // Read every source file once (paired with its path), then test all operations
  // against the cache instead of re-reading each file for every operation.
  const sources = readSourceFiles(tsFiles);
  const fileContents = sources.map((source) => source.content);

  // One sweep yields both the unused set and the per-operation explanations
  // that `--verbose` reports.
  const operationUsages = explainOperationUsage(
    operations,
    sources,
    usagePatterns,
  );
  const unusedOperations = operationUsages
    .filter((usage) => !usage.match)
    .map((usage) => usage.operation);
  const unusedFragments = findUnusedFragmentsInCorpus(
    parsedFiles,
    fileContents,
    fragmentUsagePatterns,
  );
  const generatedFiles = detectGeneratedFiles(
    sources,
    operations,
    usagePatterns,
  );
  // Opt-in: skip the whole pass (and its per-key source sweep) when it is off.
  const unusedFieldCandidates = resolveCheckFields(config)
    ? findUnusedFieldCandidates(
        parsedFiles,
        unusedOperations,
        unusedFragments,
        sources,
      )
    : [];

  return {
    gqlFileCount: gqlFiles.length,
    sourceFileCount: tsFiles.length,
    operationCount: operations.length,
    gqlFiles,
    operationUsages,
    unusedOperations,
    unusedFragments,
    orphanedFiles: findOrphanedFiles(
      parsedFiles,
      unusedOperations,
      unusedFragments,
    ),
    unusedFieldCandidates,
    duplicateWarnings: findDuplicateNameWarnings(parsedFiles),
    generatedWarnings: formatGeneratedFileWarnings(generatedFiles),
    generatedFiles,
  };
}

export function mainFunction(
  options: {
    json?: boolean;
    annotate?: boolean;
    verbose?: boolean;
    config?: CliConfig;
  } = {},
) {
  const json = options.json ?? false;
  const annotate = options.annotate ?? false;
  const verbose = options.verbose ?? false;
  // Verbose lines go to stderr so stdout stays clean for --json.
  const logVerbose = (lines: string[]): void => {
    for (const line of lines) {
      console.error(kleur.dim(`[verbose] ${line}`));
    }
  };

  let resolved: Partial<GqlPruneConfig>;
  try {
    resolved = resolveConfig(options.config);
  } catch (e) {
    console.error(kleur.red('Error reading gqlPrune.config.yaml.'));
    console.error(e);
    process.exit(2);
  }

  const graphqlDirs = resolveDirs(resolved.graphqlDir);
  const srcDirs = resolveDirs(resolved.srcDir);

  if (graphqlDirs.length === 0 || srcDirs.length === 0) {
    console.error(
      kleur.red(
        'No configuration found. Create gqlPrune.config.yaml (run "gqlprune init") or pass --graphql <dir> and --src <dir>.',
      ),
    );
    process.exit(2);
  }

  const missingDirs = [...graphqlDirs, ...srcDirs].filter(
    (dir) => !directoryExists(dir),
  );
  if (missingDirs.length > 0) {
    console.error(
      kleur.red(
        `These configured directories do not exist: ${missingDirs.join(', ')}.`,
      ),
    );
    process.exit(2);
  }

  // All directories exist; carry the normalized lists forward.
  const config: GqlPruneConfig = {
    ...resolved,
    graphqlDir: graphqlDirs,
    srcDir: srcDirs,
  };

  // ---------------- Main Logic ----------------

  if (verbose) {
    logVerbose(formatVerboseConfigLines(config));
  }

  const result = scanProject(config);
  const {
    gqlFileCount,
    sourceFileCount,
    operationCount,
    unusedOperations,
    unusedFragments,
    orphanedFiles,
    unusedFieldCandidates,
    duplicateWarnings,
    generatedWarnings,
  } = result;
  // Absent (not empty) in the JSON when the check is off, so a consumer can
  // tell "nothing found" from "never looked".
  const fieldCandidates = resolveCheckFields(config)
    ? unusedFieldCandidates
    : undefined;
  // All advisory warnings share one pipeline: stderr lines (or ::warning in
  // annotate mode) plus the JSON report's `warnings` array.
  const advisoryWarnings = [...duplicateWarnings, ...generatedWarnings];

  if (verbose) {
    logVerbose(formatVerboseScanLines(result));
  }

  if (!json) {
    console.log(
      `Found ${kleur.yellow(gqlFileCount.toString())} GraphQL files.`,
    );
    console.log(
      `Found ${kleur.yellow(operationCount.toString())} GraphQL operations.`,
    );
    console.log(
      `Found ${kleur.yellow(sourceFileCount.toString())} source files.`,
    );
  }

  // Warn when a single file references most operations (e.g. un-excluded codegen
  // output): it would silently make every operation look "used" and report
  // nothing unused. Emit to stderr so it surfaces in --json mode too without
  // corrupting the JSON on stdout.
  for (const line of advisoryWarnings) {
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
    for (const line of formatAnnotations(
      unusedOperations,
      unusedFragments,
      orphanedFiles,
      unusedFieldCandidates,
    )) {
      console.error(line);
    }
  }

  if (json) {
    console.log(
      JSON.stringify(
        buildJsonReport(
          unusedOperations,
          unusedFragments,
          advisoryWarnings,
          orphanedFiles,
          fieldCandidates,
        ),
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
    // Advisory only, so it still prints on the all-clear path — and, having its
    // own caveat, without the closing reminder that the exit paths carry.
    if (unusedFieldCandidates.length > 0) {
      reportUnusedFieldCandidates(unusedFieldCandidates);
    }
    return;
  }

  if (unusedOperations.length > 0) {
    reportUnusedOperations(unusedOperations);
  }
  if (unusedFragments.length > 0) {
    reportUnusedFragments(unusedFragments);
  }
  // An orphaned file always implies unused definitions, so this section only
  // ever follows one of the two above; it never carries the exit code alone.
  if (orphanedFiles.length > 0) {
    reportOrphanedFiles(orphanedFiles);
  }
  // Advisory, so it prints last and never contributes to the exit code.
  if (unusedFieldCandidates.length > 0) {
    reportUnusedFieldCandidates(unusedFieldCandidates);
  }
  // Covers every candidate class above, so it closes the report.
  console.log(kleur.dim(CANDIDATE_REMINDER));

  // Use exitCode (not process.exit) so all report output flushes before exit.
  process.exitCode = 1;
}
