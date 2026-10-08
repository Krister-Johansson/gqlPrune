// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import fs from 'fs';
import kleur from 'kleur';
import * as yaml from 'js-yaml';
import path from 'path';
import { assertValidSchema, buildSchema, GraphQLSchema } from 'graphql';
import { OperationInfo } from '../types/OperationInfo.js';
import { CliConfig, GqlPruneConfig } from '../types/GqlPruneConfig.js';
import {
  createExcludeMatcher,
  DEFAULT_EXCLUDED_FOLDERS,
  directoryExists,
  ExcludeMatcher,
  expandDirPatterns,
  findFilesWithExtension,
  DEFAULT_SOURCE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  readSourceFiles,
  SourceFile,
} from '../utils/fileUtils.js';
import {
  buildUsagePatterns,
  DEFAULT_FRAGMENT_USAGE_PATTERNS,
  DEFAULT_USAGE_PATTERNS,
  expandPattern,
} from '../utils/usagePatterns.js';
import {
  extractGraphqlEntities,
  GraphqlFileEntities,
} from '../utils/operations.js';
import {
  extractInlineDocuments,
  findInlineIdentifierUsage,
  InlineIdentifierUsage,
  toInlineEntities,
} from '../utils/inline.js';
import {
  CodegenDerivation,
  deriveGqlPruneConfig,
  discoverCodegenConfig,
  formatCodegenInfoLine,
  formatCodegenVerboseLines,
  loadCodegenConfig,
} from '../utils/codegen.js';
import { findUnusedFragmentsInCorpus } from '../utils/fragments.js';
import { blankRanges, pluralize } from '../utils/stringHelpers.js';
import { buildSourceModule, modulePathOf } from '../utils/sourceModule.js';
import {
  buildReferenceIndex,
  describeResolution,
  ReferenceIndex,
} from '../utils/referenceIndex.js';
import {
  createCorpusResolver,
  ModuleResolver,
} from '../utils/moduleResolver.js';
import { loadCompilerOptions } from '../utils/tsconfig.js';
import {
  findUnusedFieldCandidates,
  OperationFieldTrace,
  SourcePosition,
} from '../utils/fields.js';
import { findOrphanedFiles } from '../utils/orphans.js';
import { DeprecatedUsage, findDeprecatedUsages } from '../utils/deprecated.js';
import {
  CONFIDENCE_LEVELS,
  countByConfidence,
  describeConfidence,
  filterByConfidence,
  GradedField,
  GradedFragment,
  GradedOperation,
  gradeFieldCandidates,
  gradeFragments,
  gradeOperations,
  gradeOrphanedFiles,
  isConfidenceLevel,
  OrphanedFile,
} from '../utils/confidence.js';
import { ConfidenceLevel } from '../types/Confidence.js';

// Defined in fileUtils (the directory walks need it too) and re-exported here,
// where the exclude handling lives.
export { DEFAULT_EXCLUDED_FOLDERS };

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
 * built from the user's `exclude`/`excludedFolders` patterns, so a `!`
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
  return resolveStringList(value);
}

/**
 * Normalizes a config value that is a string or a list of strings into a
 * trimmed list, dropping blanks.
 *
 * YAML can yield non-string entries (`- 8080`), which are dropped rather than
 * crashing on `.trim()`. This is the lenient reading, right where a stray entry
 * simply never matches anything; a setting where a stray entry would change the
 * verdict validates instead of dropping.
 *
 * @param {string | string[] | undefined} value - The configured value.
 * @returns {string[]} - The normalized entries.
 */
export function resolveStringList(
  value: string | string[] | undefined,
): string[] {
  const list = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  return (list as unknown[])
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * A configuration value the run cannot proceed with. Thrown from the pure
 * resolvers so they stay testable, and turned into the exit-2 message by
 * `mainFunction`, which owns every exit path.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Returns the configured usage patterns, falling back to the defaults when none
 * are provided.
 */
export function resolveUsagePatterns(config: GqlPruneConfig): string[] {
  return resolvePatternList(config.usagePatterns, DEFAULT_USAGE_PATTERNS);
}

/**
 * Normalizes a configured pattern list. A single pattern written as a YAML
 * scalar counts, an omitted key falls back to the defaults, and an explicit
 * empty list is respected rather than treated as absent.
 *
 * Every entry has to be a string. A YAML list of ports or version numbers
 * reaches `expandPattern` as a number otherwise, where `pattern.replace` throws
 * and takes the whole run down with a stack trace.
 *
 * @param {unknown} configured - The value read from the config or the flags.
 * @param {string[]} fallback - The patterns to use when none are configured.
 * @returns {string[]} - The patterns to search for.
 */
export function resolvePatternList(
  configured: unknown,
  fallback: string[],
  setting = 'usagePatterns',
): string[] {
  if (configured === undefined || configured === null) return fallback;
  const list = Array.isArray(configured) ? configured : [configured];
  const patterns = list
    .filter((pattern) => typeof pattern === 'string')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern !== '');
  if (patterns.length !== list.length) {
    throw new ConfigError(
      `Every entry in "${setting}" must be a non-empty string. Got: ` +
        `${list.map((pattern) => JSON.stringify(pattern)).join(', ')}.`,
    );
  }
  // Usage is decided by identifier references, so a pattern that expands to
  // anything but an identifier can never match and would only produce a
  // silent all-clear.
  for (const pattern of patterns) {
    const expanded = expandPattern(pattern, SAMPLE_OPERATION);
    if (!IDENTIFIER.test(expanded)) {
      throw new ConfigError(
        `Every entry in "${setting}" must expand to an identifier: ` +
          `"${pattern}" expands to "${expanded}" for an operation named ` +
          `${SAMPLE_OPERATION.name}. Usage is decided by references to ` +
          'identifiers, so a pattern with other characters can never match.',
      );
    }
  }
  return patterns;
}

/** An operation to expand a pattern with, purely to check its shape. */
const SAMPLE_OPERATION: OperationInfo = {
  name: 'Sample',
  type: 'query',
  filePath: '',
};

/** A whole JavaScript identifier. */
const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u;

/**
 * Returns the configured fragment usage patterns. Falls back to the defaults
 * only when the option is omitted; an explicit empty array is respected (it
 * disables source-reference detection, leaving spread-graph reachability only).
 */
export function resolveFragmentUsagePatterns(config: GqlPruneConfig): string[] {
  return resolvePatternList(
    config.fragmentUsagePatterns,
    DEFAULT_FRAGMENT_USAGE_PATTERNS,
    'fragmentUsagePatterns',
  );
}

/**
 * Whether the opt-in field-candidate check runs. Strictly boolean `true`, so a
 * stray YAML value never silently enables an advisory scan of every selection.
 */
export function resolveCheckFields(config: GqlPruneConfig): boolean {
  return config.checkFields === true;
}

/**
 * Whether the opt-in inline-document scan runs. Strictly boolean `true`, like
 * {@link resolveCheckFields}, so a stray YAML value never silently changes what
 * a scan considers a definition.
 */
export function resolveInline(config: GqlPruneConfig): boolean {
  return config.inline === true;
}

/** Where and how a reference that decided a verdict was found. */
export type UsageMatch = {
  /** The identifier the reference resolved to, one of the expanded patterns. */
  pattern: string;
  file: string;
  /** Absent for a document used where it stands, which has no reference site. */
  line?: number;
  column?: number;
  /** The import and re-export hops between the reference and the name, for `--verbose`. */
  via: string[];
};

/** How a single operation's used/unused verdict was reached. */
export type OperationUsage = {
  operation: OperationInfo;
  /** The concrete identifiers expanded from the usage patterns. */
  patterns: string[];
  /** The first reference that resolves to a pattern; absent when the operation is unused. */
  match?: UsageMatch;
};

/**
 * Determines, for every operation, whether something in the sources
 * references a binding that resolves to one of its expanded patterns, and
 * when it does, where. The unused set is what has no `match`; the detail is
 * what lets `--verbose` explain each verdict.
 */
export function explainOperationUsage(
  operations: OperationInfo[],
  index: ReferenceIndex,
  usagePatterns: string[],
): OperationUsage[] {
  return operations.map((operation) => {
    const patterns = buildUsagePatterns(operation, usagePatterns);
    const reference = index.firstReference(patterns);
    return reference === undefined
      ? { operation, patterns }
      : {
          operation,
          patterns,
          match: {
            pattern: reference.canonical.name,
            file: reference.file,
            line: reference.line,
            column: reference.column,
            via: describeResolution(reference.canonical),
          },
        };
  });
}

/**
 * Marks the operations of an inline document as used when the constant the
 * document is assigned to is referenced somewhere in the corpus. This is the
 * one usage signal no pattern can express: under the client preset the code
 * reads `const q = graphql(...)` and then `useQuery(q)`, and the operation's own
 * name never appears outside the document.
 *
 * The verdict is keyed by operation name, like every other verdict in the tool,
 * so same-named definitions share it (`findDuplicateNameWarnings` reports that).
 *
 * @param {OperationUsage[]} usages - Verdicts from {@link explainOperationUsage}.
 * @param {InlineIdentifierUsage[]} inlineUsage - The referenced inline documents.
 * @returns {OperationUsage[]} - The verdicts, with referenced ones marked used.
 */
export function applyInlineIdentifierUsage(
  usages: OperationUsage[],
  inlineUsage: InlineIdentifierUsage[],
): OperationUsage[] {
  if (inlineUsage.length === 0) {
    return usages;
  }
  const matchByName = new Map<string, UsageMatch>();
  for (const { identifier, file, line, column, operations } of inlineUsage) {
    for (const name of operations) {
      matchByName.set(name, {
        pattern: identifier,
        file,
        ...(line === undefined ? {} : { line, column }),
        via: [],
      });
    }
  }
  return usages.map((usage) => {
    if (usage.match !== undefined) {
      return usage;
    }
    const match = matchByName.get(usage.operation.name);
    return match === undefined ? usage : { ...usage, match };
  });
}

/**
 * The source extensions to scan, normalized to lowercase with a leading dot so
 * `vue`, `.VUE` and `.vue` all mean the same thing.
 *
 * @param {string | string[]} [configured] - The configured extensions, if any.
 * @returns {string[]} - The extensions to match.
 */
export function resolveSourceExtensions(
  configured?: string | string[],
): string[] {
  const list = resolveStringList(configured);
  if (list.length === 0) return DEFAULT_SOURCE_EXTENSIONS;
  return list.map((extension) => {
    const lower = extension.toLowerCase();
    return lower.startsWith('.') ? lower : `.${lower}`;
  });
}

/** Header of the confidence column, and the width every such column takes. */
const CONFIDENCE_HEADER = 'Confidence';

/** The banner that opens a report section. */
export function sectionTitle(name: string): string {
  return `--- ${name} ---`;
}

/**
 * The dash rule that closes a report section, exactly as wide as its banner.
 * Derived from the name rather than typed out, so renaming a section cannot
 * leave the rule a character short with nothing to notice.
 */
export function sectionRule(name: string): string {
  return '-'.repeat(sectionTitle(name).length);
}

/**
 * Prints one report section: the banner, whatever `body` prints, then the
 * closing rule. The count line each section ends with is the caller's, since
 * its wording and colour differ per section.
 */
function printSection(name: string, body: () => void): void {
  console.log(kleur.blue(`\n${sectionTitle(name)}\n`));
  body();
  console.log(kleur.blue(sectionRule(name)));
}

/** The width a column needs: its header, or its widest value. */
function columnWidth(header: string, values: string[]): number {
  return Math.max(header.length, ...values.map((value) => value.length));
}

/**
 * Colours one grade for the tables: the strongest evidence stands out and the
 * weakest recedes, so a table of nothing but `high` still reads as a plain
 * column rather than a wall of colour.
 */
function paintConfidence(text: string, level: ConfidenceLevel): string {
  if (level === 'high') return kleur.red(text);
  if (level === 'medium') return kleur.yellow(text);
  return kleur.dim(text);
}

/** One padded, coloured confidence cell. */
function confidenceCell(level: ConfidenceLevel): string {
  return paintConfidence(level.padEnd(CONFIDENCE_HEADER.length), level);
}

/** Prints the aligned table of unused operations. */
function reportUnusedOperations(unusedOperations: GradedOperation[]): void {
  const typeWidth = columnWidth(
    'Type',
    unusedOperations.map((op) => op.type),
  );
  const nameWidth = columnWidth(
    'Operation',
    unusedOperations.map((op) => op.name),
  );

  printSection('Unused GraphQL Operations', () => {
    console.log(
      'Type'.padEnd(typeWidth),
      'Operation'.padEnd(nameWidth),
      CONFIDENCE_HEADER,
      'File',
    );
    unusedOperations.forEach((op) => {
      console.log(
        `${kleur.yellow(op.type.padEnd(typeWidth))} ${kleur.cyan(
          op.name.padEnd(nameWidth),
        )} ${confidenceCell(op.confidence)} ${kleur.magenta(path.basename(op.filePath))}`,
      );
    });
  });
  const count = unusedOperations.length;
  console.log(
    kleur.red(
      `Found ${count} ${pluralize(count, 'unused GraphQL operation')}. ` +
        `Please remove ${pluralize(count, 'it', 'them')}.`,
    ),
  );
}

/** Prints the aligned table of unused fragments. */
function reportUnusedFragments(unusedFragments: GradedFragment[]): void {
  const nameWidth = columnWidth(
    'Fragment',
    unusedFragments.map((fragment) => fragment.name),
  );

  printSection('Unused GraphQL Fragments', () => {
    console.log('Fragment'.padEnd(nameWidth), CONFIDENCE_HEADER, 'File');
    unusedFragments.forEach((fragment) => {
      console.log(
        `${kleur.cyan(fragment.name.padEnd(nameWidth))} ${confidenceCell(
          fragment.confidence,
        )} ${kleur.magenta(path.basename(fragment.filePath))}`,
      );
    });
  });
  const count = unusedFragments.length;
  console.log(
    kleur.red(
      `Found ${count} ${pluralize(count, 'unused GraphQL fragment')}. ` +
        `Please remove ${pluralize(count, 'it', 'them')}.`,
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
 * the operation, the path and the grade shown on its first row only.
 */
function reportUnusedFieldCandidates(candidates: GradedField[]): void {
  const operationWidth = columnWidth(
    'Operation',
    candidates.map((candidate) => candidate.operation),
  );
  const pathWidth = columnWidth(
    'Path',
    candidates.map((candidate) => candidate.path),
  );

  printSection('Unused Field Candidates', () => {
    console.log(
      'Operation'.padEnd(operationWidth),
      'Path'.padEnd(pathWidth),
      CONFIDENCE_HEADER,
      'Selected in',
    );
    candidates.forEach((candidate) => {
      candidate.locations.forEach((location, index) => {
        const first = index === 0;
        // The operation, path and grade belong to the finding, not to each of
        // its selections, so they sit on the first row and the rest stay blank.
        const operation = first ? candidate.operation : '';
        const fieldPath = first ? candidate.path : '';
        const grade = first
          ? confidenceCell(candidate.confidence)
          : ''.padEnd(CONFIDENCE_HEADER.length);
        console.log(
          `${kleur.cyan(operation.padEnd(operationWidth))} ${kleur.cyan(
            fieldPath.padEnd(pathWidth),
          )} ${grade} ${kleur.magenta(formatFieldLocation(location))}`,
        );
      });
    });
  });
  const count = candidates.length;
  console.log(
    kleur.yellow(
      `Found ${count} ${pluralize(count, 'field candidate')} that nothing ` +
        'in the source appears to read.',
    ),
  );
  // Only what is specific to fields. The closing reminder covers the rest, so
  // saying "verify before deleting" here as well would print it twice.
  console.log(
    kleur.dim(
      'A high candidate was traced from every call site of its operation, ' +
        'and a value handed to code the trace cannot follow counts as read. ' +
        'A medium candidate was matched by name alone, so a read through a ' +
        'computed key or a spread looks the same as no read, and a common ' +
        'name is never flagged. A field read by another repository looks ' +
        'unread either way.',
    ),
  );
}

/** Prints the list of orphaned GraphQL files. */
function reportOrphanedFiles(orphanedFiles: OrphanedFile[]): void {
  printSection('Orphaned GraphQL Files', () => {
    console.log(CONFIDENCE_HEADER, 'File');
    orphanedFiles.forEach((orphan) =>
      console.log(
        `${confidenceCell(orphan.confidence)} ${kleur.magenta(orphan.file)}`,
      ),
    );
  });
  const count = orphanedFiles.length;
  const them = pluralize(count, 'it', 'them');
  console.log(
    kleur.red(
      `Found ${count} ${pluralize(count, 'orphaned GraphQL file')}. Every ` +
        `definition in ${them} is unused and no document imports ${them}, so ` +
        `${pluralize(count, 'it', 'they')} can likely be deleted.`,
    ),
  );
}

/** Prints the deprecated field/enum selections found against the local SDL. */
function reportDeprecatedUsages(deprecatedUsages: DeprecatedUsage[]): void {
  const fileWidth = columnWidth(
    'File',
    deprecatedUsages.map((usage) => usage.file),
  );

  printSection('Deprecated Field Usage', () => {
    console.log('File'.padEnd(fileWidth), 'Line', 'Message');
    deprecatedUsages.forEach((usage) => {
      console.log(
        `${kleur.magenta(usage.file.padEnd(fileWidth))} ${kleur.cyan(
          String(usage.line ?? '-').padEnd(4),
        )} ${usage.message}`,
      );
    });
  });
  const count = deprecatedUsages.length;
  console.log(
    kleur.yellow(
      `Found ${count} ${pluralize(count, 'selection')} of deprecated schema ` +
        `fields or enum values. ${pluralize(count, 'It is', 'They are')} ` +
        `advisory and ${pluralize(count, 'does', 'do')} not affect the exit code.`,
    ),
  );
}

/**
 * Closing line of the human-readable report. Usage is read from the source
 * without running it, so a finding is a candidate rather than proof: names
 * built at runtime, or referenced outside `srcDir` or from another repository,
 * look unused here.
 */
export const CANDIDATE_REMINDER =
  'These are candidates from a static scan. Verify each one before deleting.';

/** The machine-readable report emitted by `--json`. */
export type JsonReport = {
  unusedOperations: {
    name: string;
    type: string;
    file: string;
    line?: number;
    confidence: ConfidenceLevel;
    reason: string;
  }[];
  unusedFragments: {
    name: string;
    file: string;
    line?: number;
    confidence: ConfidenceLevel;
    reason: string;
  }[];
  /** Files whose every definition is unused and which nothing imports. */
  orphanedFiles: OrphanedFile[];
  /** Selections of `@deprecated` fields/enum values; empty without a schema. */
  deprecatedUsages: DeprecatedUsage[];
  /**
   * Field candidates. Present only when the opt-in check ran, so an absent key
   * means "not checked" rather than "nothing found".
   */
  unusedFields?: GradedField[];
  /** Advisory warnings (e.g. a suspected generated file masking results). */
  warnings: string[];
  summary: {
    unusedOperations: number;
    unusedFragments: number;
    orphanedFiles: number;
    deprecatedUsages: number;
    unusedFields?: number;
    /** Every graded finding in this report, counted per level. */
    byConfidence: Record<ConfidenceLevel, number>;
  };
};

/**
 * Builds the structured report for `--json` output. `unusedFields` is omitted
 * entirely when the opt-in field check did not run. An empty array would claim
 * a clean result the scan never looked for.
 *
 * Every candidate kind carries its `confidence` and the `reason` behind it;
 * `summary.byConfidence` counts them all together. Deprecated selections are
 * left ungraded: they are validated against a real schema, so they are facts
 * rather than candidates.
 */
export function buildJsonReport(
  unusedOperations: GradedOperation[],
  unusedFragments: GradedFragment[],
  warnings: string[] = [],
  orphanedFiles: OrphanedFile[] = [],
  deprecatedUsages: DeprecatedUsage[] = [],
  unusedFields?: GradedField[],
): JsonReport {
  return {
    unusedOperations: unusedOperations.map((op) => ({
      name: op.name,
      type: op.type,
      file: op.filePath,
      line: op.line,
      confidence: op.confidence,
      reason: op.reason,
    })),
    unusedFragments: unusedFragments.map((fragment) => ({
      name: fragment.name,
      file: fragment.filePath,
      line: fragment.line,
      confidence: fragment.confidence,
      reason: fragment.reason,
    })),
    orphanedFiles,
    deprecatedUsages,
    ...(unusedFields ? { unusedFields } : {}),
    warnings,
    summary: {
      unusedOperations: unusedOperations.length,
      unusedFragments: unusedFragments.length,
      orphanedFiles: orphanedFiles.length,
      deprecatedUsages: deprecatedUsages.length,
      ...(unusedFields ? { unusedFields: unusedFields.length } : {}),
      byConfidence: countByConfidence([
        ...unusedOperations,
        ...unusedFragments,
        ...orphanedFiles,
        ...(unusedFields ?? []),
      ]),
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
 * fragments, for each orphaned file and for each deprecated selection, so they
 * surface inline on a PR. Omits the line when unknown. Field candidates get one
 * annotation each, pinned to their first selection and naming the path and
 * the operation.
 *
 * Every candidate annotation ends with its confidence grade, so a reviewer can
 * triage straight from the Files changed tab. Deprecated selections carry no
 * grade: the schema already settled them.
 */
export function formatAnnotations(
  unusedOperations: GradedOperation[],
  unusedFragments: GradedFragment[],
  orphanedFiles: OrphanedFile[] = [],
  deprecatedUsages: DeprecatedUsage[] = [],
  unusedFields: GradedField[] = [],
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
  const graded = (message: string, level: ConfidenceLevel): string =>
    `${message} [confidence: ${level}]`;
  return [
    ...unusedOperations.map((op) =>
      annotate(
        op.filePath,
        op.line,
        graded(
          `Unused GraphQL operation "${op.name}" (${op.type})`,
          op.confidence,
        ),
      ),
    ),
    ...unusedFragments.map((fragment) =>
      annotate(
        fragment.filePath,
        fragment.line,
        graded(
          `Unused GraphQL fragment "${fragment.name}"`,
          fragment.confidence,
        ),
      ),
    ),
    ...orphanedFiles.map((orphan) =>
      annotate(
        orphan.file,
        undefined,
        graded(
          'Orphaned GraphQL file: every definition is unused and no document imports it',
          orphan.confidence,
        ),
      ),
    ),
    // The validator's message already names the deprecated field or enum value
    // and its replacement, so it stands on its own as the annotation text.
    ...deprecatedUsages.map((usage) =>
      annotate(usage.file, usage.line, usage.message),
    ),
    ...unusedFields.map((candidate) =>
      annotate(
        candidate.locations[0].file,
        candidate.locations[0].line,
        graded(
          `Unused GraphQL field candidate "${candidate.path}" in operation ` +
            `"${candidate.operation}" (${
              candidate.reason === 'never-read'
                ? 'no traced read reaches it'
                : 'name not found in source'
            })`,
          candidate.confidence,
        ),
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
 * this, "one file references most operations" is uninformative: a small project
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
 * references most operations, the classic failure mode where GraphQL Code
 * Generator output lives inside `srcDir` un-excluded, so every operation looks
 * "used" and nothing is ever reported unused.
 *
 * The trigger is coverage: a file referencing at least
 * {@link GENERATED_COVERAGE_THRESHOLD} of all operations, and only when there
 * are at least {@link GENERATED_MIN_OPERATIONS}. A generated-looking filename or
 * header never triggers on its own (a generated file that references no
 * operations is harmless) but is reported as a corroborating reason.
 */
export function detectGeneratedFiles(
  index: ReferenceIndex,
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
    // Declared or referenced: codegen output declares every hook and references
    // every document constant from inside it, and either alone masks a scan.
    const names = index.identifiersByFile.get(modulePathOf(file));
    const matchedOperations = operationPatterns.filter((patterns) =>
      patterns.some((pattern) => names?.has(pattern) ?? false),
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
 * conflated: every definition shares one used/unused verdict. Returned as
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
 * Reads `gqlPrune.config.yaml`, or returns `{}` when there is none. Throws on a
 * malformed or otherwise unreadable file so the problem isn't silently ignored.
 */
function readFileConfig(): Partial<GqlPruneConfig> {
  let raw: string | undefined;
  try {
    raw = fs.readFileSync('./gqlPrune.config.yaml', 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error; // permissions or similar: surface it rather than hide it
    }
    // No config file: rely entirely on CLI flags.
  }
  // An empty/whitespace-only file is treated as no config (parsing it throws),
  // so CLI flags alone can still drive the run.
  if (raw === undefined || raw.trim() === '') return {};
  return (yaml.load(raw) as GqlPruneConfig) ?? {};
}

/** A run's configuration, plus where any codegen-derived values came from. */
export type ResolvedRunConfig = {
  config: Partial<GqlPruneConfig>;
  /** Present when a codegen config supplied values that took effect. */
  codegen?: CodegenDerivation;
  /** Why no codegen config was used, when one was looked for (`--verbose`). */
  codegenNotice?: string;
  /** A config named by `--codegen`/`codegenConfig` that could not be read. */
  codegenError?: string;
};

/**
 * Resolves everything a run needs, in strict precedence: CLI flags, then
 * `gqlPrune.config.yaml`, then a GraphQL Code Generator config, then the
 * built-in defaults.
 *
 * The codegen layer is read in two cases only. When `--codegen`/`codegenConfig`
 * names a file, it is read wherever it sits, and a file that cannot be read is
 * an error the caller reports. Otherwise it is looked for in the working
 * directory, and only when neither the config file nor a flag says which
 * directories to scan. That is exactly the run that fails today with "No
 * configuration found", so an inferred setting can never change the result of a
 * project that is already configured.
 *
 * @param {CliConfig} cliConfig - Overrides collected from the CLI flags.
 * @returns {ResolvedRunConfig} - The configuration and its codegen provenance.
 */
export function resolveRunConfig(cliConfig: CliConfig = {}): ResolvedRunConfig {
  const merged = { ...readFileConfig(), ...cliConfig };
  const requested =
    typeof merged.codegenConfig === 'string' ? merged.codegenConfig.trim() : '';
  const unconfigured =
    resolveDirs(merged.graphqlDir).length === 0 &&
    resolveDirs(merged.srcDir).length === 0;
  if (requested === '' && !unconfigured) return { config: merged };

  const lookup =
    requested === '' ? discoverCodegenConfig() : loadCodegenConfig(requested);
  if (!lookup.found) {
    return requested === ''
      ? { config: merged, codegenNotice: lookup.reason }
      : { config: merged, codegenError: lookup.reason };
  }
  // Lowest precedence: only the keys nothing else already decided. A key that
  // is present but empty (`graphqlDir:` on its own, which js-yaml reads as
  // null) has decided nothing, so it must not block the derived value. Testing
  // for the key alone made such a config derive everything except the two
  // directories and then stop, advising the user to run `gqlprune init`, which
  // is what had just written the file.
  const decided = (key: string): boolean =>
    merged[key as keyof typeof merged] !== undefined &&
    merged[key as keyof typeof merged] !== null;
  const values = Object.fromEntries(
    Object.entries(deriveGqlPruneConfig(lookup.config)).filter(
      ([key]) => !decided(key),
    ),
  );
  // An empty key decided nothing, so it must not overwrite the derived value
  // it just let through either.
  const stated = Object.fromEntries(
    Object.entries(merged).filter(([key]) => decided(key)),
  );
  return {
    config: { ...values, ...stated },
    ...(Object.keys(values).length > 0
      ? { codegen: { file: lookup.config.file, values } }
      : { codegenNotice: `Nothing to derive from ${lookup.config.file}.` }),
  };
}

/**
 * The codegen config a setting was derived from, or `undefined` when the user
 * wrote it themselves.
 *
 * The distinction drives one rule: **explicit configuration fails loudly,
 * inference degrades gracefully.** A value from `gqlPrune.config.yaml` or a CLI
 * flag that does not resolve ends the run with exit code 2, because the user
 * asked for it and a silent skip would hide their mistake. A value gqlPrune
 * derived from a codegen config never turns a runnable scan into a fatal error:
 * it is dropped with an advisory warning and the scan carries on.
 *
 * @param {ResolvedRunConfig} run - The resolved run, with its provenance.
 * @param {keyof GqlPruneConfig} key - The setting to ask about.
 * @returns {string | undefined} - The codegen file, when the value came from one.
 */
export function codegenSource(
  run: ResolvedRunConfig,
  key: keyof GqlPruneConfig,
): string | undefined {
  return run.codegen !== undefined && key in run.codegen.values
    ? run.codegen.file
    : undefined;
}

/**
 * The advisory warning for a `schemaFile` that was derived from a codegen
 * config and cannot be used. A codegen `schema` is routinely a path that is only
 * filled in at build time, so it must cost the deprecated-selection check and
 * nothing else.
 */
export function formatDerivedSchemaWarning(
  codegenFile: string,
  schemaFile: string,
): string {
  return (
    `Skipped the deprecated-selection check: the schema "${schemaFile}" derived ` +
    `from ${codegenFile} could not be read or parsed. Set "schemaFile" in ` +
    'gqlPrune.config.yaml to check against a schema of your own.'
  );
}

/** The directories a scan will walk, plus anything the caller must report. */
export type ResolvedScanDirs = {
  graphqlDir: string[];
  srcDir: string[];
  /** Advisory warnings for derived directories that were dropped. */
  warnings: string[];
  /** Set when nothing scannable is left; the run must stop with exit code 2. */
  error?: string;
};

/**
 * Turns the configured `graphqlDir`/`srcDir` values into the directories to
 * scan: globs are expanded, and paths that are not on disk are checked.
 *
 * Which failures are fatal depends on where the value came from (see
 * {@link codegenSource}). A directory the user configured that does not exist
 * ends the run. A derived one is dropped with a warning, and only an empty
 * result stops the run, with a message that names the codegen config: the user
 * never wrote the path it complains about.
 *
 * @param {string[]} graphqlDir - Configured GraphQL directories.
 * @param {string[]} srcDir - Configured source directories.
 * @param {object} derived - Per field, the codegen file it was derived from.
 * @returns {ResolvedScanDirs} - The surviving directories, warnings and error.
 */
export function resolveScanDirs(
  graphqlDir: string[],
  srcDir: string[],
  derived: { graphqlDir?: string; srcDir?: string } = {},
): ResolvedScanDirs {
  // A subtree a glob walk could not read is an advisory like any other: it
  // travels with the derived-directory warnings whatever else happens, since
  // a run that stops on a missing directory still owes the reason it saw less.
  const warnings: string[] = [];
  const stop = (error: string): ResolvedScanDirs => ({
    graphqlDir: [],
    srcDir: [],
    warnings,
    error,
  });

  const expanded = [
    { field: 'graphqlDir', configured: graphqlDir, from: derived.graphqlDir },
    { field: 'srcDir', configured: srcDir, from: derived.srcDir },
  ].map((field) => ({
    ...field,
    ...expandDirPatterns(field.configured, (message) => warnings.push(message)),
  }));

  // A glob that matches nothing is checked first, before anything touches the
  // filesystem, exactly as it always was.
  const explicitUnmatched = expanded
    .filter((entry) => entry.from === undefined)
    .flatMap((entry) => entry.unmatched);
  if (explicitUnmatched.length > 0) {
    return stop(
      `These configured directory patterns match no directories: ${explicitUnmatched.join(', ')}.`,
    );
  }

  const checked = expanded.map((entry) => {
    const present = entry.dirs.filter((dir) => directoryExists(dir));
    const missing = entry.dirs.filter((dir) => !present.includes(dir));
    return { ...entry, present, dropped: [...entry.unmatched, ...missing] };
  });

  const explicitMissing = checked
    .filter((entry) => entry.from === undefined)
    .flatMap((entry) => entry.dropped);
  if (explicitMissing.length > 0) {
    return stop(
      `These configured directories do not exist: ${explicitMissing.join(', ')}.`,
    );
  }

  for (const entry of checked) {
    if (entry.from === undefined || entry.dropped.length === 0) continue;
    if (entry.present.length === 0) {
      return stop(
        `No directory derived from ${entry.from} for "${entry.field}" is on disk: ` +
          `${entry.dropped.join(', ')}. Set graphqlDir and srcDir in ` +
          'gqlPrune.config.yaml (run "gqlprune init") or pass --graphql <dir> ' +
          'and --src <dir>.',
      );
    }
    warnings.push(
      `Skipped "${entry.field}" ${entry.dropped.join(', ')} derived from ` +
        `${entry.from}: not on disk. Scanning ${entry.present.join(', ')}.`,
    );
  }

  return {
    graphqlDir: checked[0].present,
    srcDir: checked[1].present,
    warnings,
  };
}

/**
 * Loads configuration from `gqlPrune.config.yaml` (if present) and overlays the
 * values provided as CLI flags, which win per field. A missing config file is
 * fine: the CLI flags may supply everything. See {@link resolveRunConfig} for
 * the full precedence, including codegen-derived defaults.
 */
export function resolveConfig(
  cliConfig: CliConfig = {},
): Partial<GqlPruneConfig> {
  // Required fields may still be absent; mainFunction validates and narrows.
  return resolveRunConfig(cliConfig).config;
}

/** The result of a single project scan, free of any console output. */
export type ScanResult = {
  gqlFileCount: number;
  sourceFileCount: number;
  operationCount: number;
  /** Whether the opt-in inline-document pass ran (see `inline` / `--inline`). */
  inline: boolean;
  /** Inline documents parsed out of the source files; 0 when the pass is off. */
  inlineDocumentCount: number;
  /** Inline bodies that did not parse and were skipped. */
  inlineSkippedCount: number;
  /** The `.gql`/`.graphql` files that were scanned. */
  gqlFiles: string[];
  /** Per-operation verdicts with the matching pattern/file (see `--verbose`). */
  operationUsages: OperationUsage[];
  unusedOperations: GradedOperation[];
  unusedFragments: GradedFragment[];
  /** Files whose every definition is unused and which no document imports. */
  orphanedFiles: OrphanedFile[];
  /**
   * Selections of `@deprecated` schema fields or enum values. Always empty
   * unless the caller passed a schema (see `schemaFile`).
   */
  deprecatedUsages: DeprecatedUsage[];
  /**
   * Advisory field candidates. Always empty unless `checkFields` is on: the
   * detection does not run at all when the option is off.
   */
  unusedFieldCandidates: GradedField[];
  /** How each used operation's fields were judged; empty unless `checkFields` is on. */
  fieldTraces: OperationFieldTrace[];
  /** Advisory duplicate-name warnings (operations and fragments). */
  duplicateWarnings: string[];
  generatedWarnings: string[];
  /** Files and directories the scan could not read or parse, as warnings. */
  readWarnings: string[];
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
    // Only when configured: the deprecated check is off by default, and an
    // empty line would suggest a setting that isn't in play.
    ...(config.schemaFile ? [`schemaFile: ${config.schemaFile}`] : []),
    ...(resolveInline(config) ? ['inline: true'] : []),
    ...(config.minConfidence ? [`minConfidence: ${config.minConfidence}`] : []),
  ];
}

/**
 * Renders the `--verbose` line for every graded finding: which grade it got and
 * the evidence behind it. Built from the unfiltered scan, so a `minConfidence`
 * run still explains what it decided to hide.
 */
export function formatVerboseConfidenceLines(
  result: Pick<
    ScanResult,
    | 'unusedOperations'
    | 'unusedFragments'
    | 'orphanedFiles'
    | 'unusedFieldCandidates'
  >,
): string[] {
  return [
    ...result.unusedOperations.map(
      (op) => `confidence: operation "${op.name}" is ${describeConfidence(op)}`,
    ),
    ...result.unusedFragments.map(
      (fragment) =>
        `confidence: fragment "${fragment.name}" is ${describeConfidence(fragment)}`,
    ),
    ...result.orphanedFiles.map(
      (orphan) =>
        `confidence: orphaned file "${orphan.file}" is ${describeConfidence(orphan)}`,
    ),
    ...result.unusedFieldCandidates.map(
      (candidate) =>
        `confidence: field "${candidate.path}" of ${candidate.operation} is ${describeConfidence(candidate)}`,
    ),
  ];
}

/** Formats a source position as `file:line:column`. */
function formatPosition(position: SourcePosition): string {
  return `${position.file}:${position.line}:${position.column}`;
}

/** Why an operation's fields were matched by name, in words, for `--verbose`. */
const FIELD_FALLBACK_TEXT = {
  'no-reference': () => 'nothing references its identifiers',
  'untraceable-reference': (reference?: SourcePosition) =>
    `the reference at ${reference ? formatPosition(reference) : 'an unknown place'} is not a call it can trace`,
  mutation: () => "a mutation's selection may exist only to update the cache",
};

/**
 * Renders the `--verbose` line for every used operation the field check
 * judged: traced, with the call sites it followed, or matched by name, with
 * the reason no trace was possible.
 *
 * @param {OperationFieldTrace[]} traces - From the field check.
 * @returns {string[]} - One line per operation.
 */
export function formatVerboseFieldLines(
  traces: OperationFieldTrace[],
): string[] {
  return traces.map((trace) => {
    const head = `fields: ${trace.operation} (${trace.type})`;
    if (trace.mode === 'traced') {
      const count = trace.callSites.length;
      return (
        `${head} traced through ${count} ${pluralize(count, 'call site')}: ` +
        trace.callSites.map(formatPosition).join(', ')
      );
    }
    const reason = FIELD_FALLBACK_TEXT[trace.fallback ?? 'no-reference'];
    return `${head} matched by name: ${reason(trace.reference)}`;
  });
}

/**
 * Renders the `--verbose` line naming the directories a `graphqlDir`/`srcDir`
 * list expanded to. Returns nothing when expansion changed nothing, since
 * {@link formatVerboseConfigLines} already prints the configured values and a
 * repeated line would only add noise.
 */
export function formatExpandedDirLines(
  field: string,
  configured: string[],
  expanded: string[],
): string[] {
  const unchanged =
    configured.length === expanded.length &&
    configured.every((dir, index) => dir === expanded[index]);
  return unchanged ? [] : [`${field} (expanded): ${expanded.join(', ')}`];
}

/**
 * Renders the scan's findings as `--verbose` lines: the files scanned, then one
 * verdict per operation, with the matching pattern and file for used ones, and
 * the searched-but-unmatched patterns for unused ones.
 */
export function formatVerboseScanLines(result: ScanResult): string[] {
  const lines = [
    `GraphQL files (${result.gqlFiles.length}): ${result.gqlFiles.join(', ')}`,
    `Source files scanned: ${result.sourceFileCount}`,
    ...(result.inline
      ? [
          `Inline documents: ${result.inlineDocumentCount} (${result.inlineSkippedCount} skipped, did not parse)`,
        ]
      : []),
  ];
  for (const { operation, patterns, match } of result.operationUsages) {
    if (match === undefined) {
      lines.push(
        `unused: ${operation.name} (${operation.type}) — no reference to ${patterns.join(', ')}`,
      );
      continue;
    }
    const where =
      match.line === undefined
        ? match.file
        : `${match.file}:${match.line}:${match.column}`;
    lines.push(
      `used:   ${operation.name} (${operation.type}) — "${match.pattern}" referenced in ${where}`,
    );
    for (const hop of match.via) lines.push(`        via ${hop}`);
  }
  return lines;
}

/**
 * What a scan needs from outside the sources it reads. Defaults to the real
 * project: the module resolver built over the read files with the compiler
 * options of the nearest tsconfig. Tests inject a map-backed resolver.
 */
export type ScanDeps = {
  /** Builds the resolver for the module paths the scan read. */
  resolver?: (
    paths: string[],
    onWarning: (message: string) => void,
  ) => ModuleResolver;
};

/**
 * Runs one full scan for the given config and returns the results without
 * printing anything. Shared by `mainFunction` (which presents the results) and
 * `gqlprune init`'s preview, so the preview always reflects the real run.
 *
 * The optional `schema` enables the deprecated-usage check. It is passed in
 * already built rather than read from `config.schemaFile` here, so that reading
 * and building it (and failing the run when it is unusable) stays in
 * `mainFunction`, and callers such as `init`'s preview keep a scan that never
 * touches a schema.
 */
export function scanProject(
  config: GqlPruneConfig,
  schema?: GraphQLSchema,
  deps: ScanDeps = {},
): ScanResult {
  const isExcluded = createConfigExcludeMatcher(config);
  const usagePatterns = resolveUsagePatterns(config);
  const fragmentUsagePatterns = resolveFragmentUsagePatterns(config);

  // Scan every configured directory and de-duplicate (dirs may overlap/nest).
  // Everything the scan could not read or parse. These are collected rather
  // than printed, so they travel the same route as every other advisory: the
  // stderr line, the JSON `warnings` array and the CI annotation. Each one
  // means part of the corpus is missing, which makes whatever it referenced
  // look unused.
  const readWarnings: string[] = [];
  const collect = (message: string): void => {
    readWarnings.push(message);
  };

  const gqlFiles = [
    ...new Set(
      resolveDirs(config.graphqlDir).flatMap((dir) =>
        findFilesWithExtension(
          dir,
          DOCUMENT_EXTENSIONS,
          isExcluded,
          new Set(),
          collect,
        ),
      ),
    ),
  ];
  // Parse every gql file once; operations and the fragment scan share the result.
  const gqlEntities = gqlFiles.map(extractGraphqlEntities);
  const missingFrom = (file: string): string =>
    `Its definitions are missing from this scan, so anything only ${file} ` +
    'referenced may be reported unused.';
  for (const entities of gqlEntities) {
    if (entities.readError !== undefined) {
      readWarnings.push(
        `Could not read ${entities.filePath}: ${entities.readError} ` +
          missingFrom(entities.filePath),
      );
    }
    if (entities.parseError !== undefined) {
      readWarnings.push(
        `Could not parse ${entities.filePath}: ${entities.parseError} ` +
          missingFrom(entities.filePath),
      );
    }
  }

  const tsFiles = [
    ...new Set(
      resolveDirs(config.srcDir).flatMap((dir) =>
        findFilesWithExtension(
          dir,
          resolveSourceExtensions(config.sourceExtensions),
          isExcluded,
          new Set(),
          collect,
        ),
      ),
    ),
  ];
  // Read every source file once (paired with its path) and parse each into
  // its module model: what it imports, exports, references and defines inline.
  const rawSources = readSourceFiles(tsFiles, collect);
  const modules = rawSources.map((source) =>
    buildSourceModule(source.file, source.content),
  );
  for (const module of modules) {
    if (module.syntaxErrors > 0) {
      readWarnings.push(
        `Could not fully parse ${module.file} (${pluralize(module.syntaxErrors, 'syntax error')}). ` +
          'Usage was read from what did parse, so something it references may look unused.',
      );
    }
  }

  // Opt-in: with the pass off, nothing is extracted. With it on, source files
  // are definition sources too. A document never counts as its own usage: its
  // body is a literal, and the constant it is assigned to is a declaration,
  // neither of which is a reference.
  const inline = resolveInline(config);
  const extractions = inline ? modules.map(extractInlineDocuments) : [];
  const inlineEntities = extractions.flatMap((extraction) =>
    toInlineEntities(extraction.documents),
  );

  // Every reference in every file, resolved through imports and re-exports.
  const buildResolver =
    deps.resolver ??
    ((paths: string[], onWarning: (message: string) => void) =>
      createCorpusResolver(
        paths,
        loadCompilerOptions(process.cwd(), onWarning),
      ));
  const index = buildReferenceIndex(
    modules,
    buildResolver(
      modules.map((module) => module.path),
      collect,
    ),
    { inline },
  );

  const parsedFiles = [...gqlEntities, ...inlineEntities];
  const operations: OperationInfo[] = parsedFiles.flatMap(
    (file) => file.operations,
  );
  const inlineUsage = findInlineIdentifierUsage(inlineEntities, index);

  // One pass over the index yields both the unused set and the per-operation
  // explanations that `--verbose` reports.
  const operationUsages = applyInlineIdentifierUsage(
    explainOperationUsage(operations, index, usagePatterns),
    inlineUsage,
  );
  const unusedOperations = operationUsages
    .filter((usage) => !usage.match)
    .map((usage) => usage.operation);
  const unusedFragments = findUnusedFragmentsInCorpus(
    parsedFiles,
    index,
    fragmentUsagePatterns,
    inlineUsage.flatMap((usage) => usage.fragments),
  );
  const generatedFiles = detectGeneratedFiles(
    index,
    rawSources,
    operations,
    usagePatterns,
  );
  // Opt-in: skip the whole pass when it is off. Call sites are traced over a
  // fresh parse of the files that hold them; an operation with nothing to
  // trace falls back to a text search, and with inline documents on, their
  // bodies are blanked so a document's own selections never vouch for
  // themselves.
  const sourcesByPath = new Map(
    modules.map((module, i) => [module.path, rawSources[i]]),
  );
  const fieldAnalysis = resolveCheckFields(config)
    ? findUnusedFieldCandidates(
        parsedFiles,
        unusedOperations,
        unusedFragments,
        inline
          ? rawSources.map((source, i) => ({
              file: source.file,
              content: blankRanges(source.content, extractions[i].bodyRanges),
            }))
          : rawSources,
        {
          index,
          usagePatterns,
          source: (modulePath) => sourcesByPath.get(modulePath),
        },
      )
    : { candidates: [], traces: [] };

  // Grade what the scan found. The bare-name evidence is what the usage pass
  // above never gathers, and it only runs over the findings, which are few by
  // construction.
  const generatedPaths = new Set(generatedFiles.map((warning) => warning.file));
  const gradedOperations = gradeOperations(
    unusedOperations,
    index,
    generatedPaths,
  );
  const gradedFragments = gradeFragments(
    unusedFragments,
    index,
    generatedPaths,
  );

  return {
    gqlFileCount: gqlFiles.length,
    // What was actually read, not what was found: if every discovered file
    // fails to read, the corpus is empty and the zero-source warning has to
    // fire, which counting the discovered paths would suppress.
    sourceFileCount: rawSources.length,
    operationCount: operations.length,
    inline,
    inlineDocumentCount: extractions.reduce(
      (total, extraction) => total + extraction.documents.length,
      0,
    ),
    inlineSkippedCount: extractions.reduce(
      (total, extraction) => total + extraction.skipped,
      0,
    ),
    gqlFiles,
    operationUsages,
    unusedOperations: gradedOperations,
    unusedFragments: gradedFragments,
    orphanedFiles: gradeOrphanedFiles(
      findOrphanedFiles(parsedFiles, unusedOperations, unusedFragments),
      gradedOperations,
      gradedFragments,
    ),
    deprecatedUsages: schema ? findDeprecatedUsages(schema, parsedFiles) : [],
    unusedFieldCandidates: gradeFieldCandidates(fieldAnalysis.candidates),
    fieldTraces: fieldAnalysis.traces,
    duplicateWarnings: findDuplicateNameWarnings(parsedFiles),
    generatedWarnings: formatGeneratedFileWarnings(generatedFiles),
    readWarnings,
    generatedFiles,
  };
}

/**
 * Runs a scan end to end: resolves the configuration, expands and checks the
 * directories, loads the optional schema, scans, and reports. Everything it
 * decides is delegated to the pure helpers above; this function only wires
 * them to the filesystem, the console and the exit code. A run that cannot
 * start ends with exit code 2 here; findings set `process.exitCode` to 1 so
 * buffered output still flushes.
 *
 * @param {object} [options] - The CLI flags and the parsed CLI configuration.
 * @returns {void}
 */
export function mainFunction(
  options: {
    json?: boolean;
    annotate?: boolean;
    verbose?: boolean;
    config?: CliConfig;
  } = {},
): void {
  const json = options.json ?? false;
  const annotate = options.annotate ?? false;
  const verbose = options.verbose ?? false;
  // Verbose lines go to stderr so stdout stays clean for --json.
  const logVerbose = (lines: string[]): void => {
    for (const line of lines) {
      console.error(kleur.dim(`[verbose] ${line}`));
    }
  };
  // One advisory line on stderr: in CI an (escaped) ::warning workflow
  // command like the other annotations, otherwise a coloured line for humans.
  const printAdvisory = (line: string): void => {
    console.error(
      annotate
        ? `::warning::${escapeAnnotationMessage(line)}`
        : kleur.yellow(`⚠ ${line}`),
    );
  };

  let run: ResolvedRunConfig;
  try {
    run = resolveRunConfig(options.config);
  } catch (e) {
    console.error(kleur.red('Error reading gqlPrune.config.yaml.'));
    console.error(e);
    process.exit(2);
  }

  // A codegen config the user asked for by name and that cannot be read is a
  // broken run, like an unreadable schema; a discovered one is only a default.
  if (run.codegenError !== undefined) {
    console.error(kleur.red(run.codegenError));
    process.exit(2);
  }
  // Report the inferred layer before anything can fail, so even a run that
  // stops at a missing directory explains where its settings came from.
  if (verbose) {
    if (run.codegenNotice !== undefined) {
      logVerbose([`codegen: ${run.codegenNotice}`]);
    }
    if (run.codegen !== undefined) {
      logVerbose(formatCodegenVerboseLines(run.codegen));
    }
  }

  const resolved = run.config;
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

  // Turn any glob (e.g. `packages/*/graphql`) into the directories it matches,
  // and check that what is left is on disk. A configured path that is not ends
  // the run; a derived one is dropped with a warning (see resolveScanDirs).
  const scanDirs = resolveScanDirs(graphqlDirs, srcDirs, {
    graphqlDir: codegenSource(run, 'graphqlDir'),
    srcDir: codegenSource(run, 'srcDir'),
  });
  if (scanDirs.error !== undefined) {
    // What the glob walk could not read explains why it matched less, so it
    // comes out before the error that ends the run.
    scanDirs.warnings.forEach(printAdvisory);
    console.error(kleur.red(scanDirs.error));
    process.exit(2);
  }
  // Collected here and emitted with the scan's own warnings further down, so
  // every advisory takes the same route to stderr, ::warning and the JSON.
  const configWarnings = [...scanDirs.warnings];

  // Optional and off unless configured: a path to a local SDL file.
  const schemaFile =
    typeof resolved.schemaFile === 'string' ? resolved.schemaFile.trim() : '';

  // The gate decides what is reported and therefore the exit code, so a value
  // outside the three levels stops the run instead of quietly gating on
  // nothing. The CLI rejects its own bad values; this catches the config file.
  const minConfidence = resolved.minConfidence;
  if (minConfidence !== undefined && !isConfidenceLevel(minConfidence)) {
    console.error(
      kleur.red(
        `Invalid minConfidence: ${String(minConfidence)}. Expected one of ${CONFIDENCE_LEVELS.join(', ')}.`,
      ),
    );
    process.exit(2);
  }

  // Every remaining directory exists; carry the expanded lists forward.
  const config: GqlPruneConfig = {
    ...resolved,
    graphqlDir: scanDirs.graphqlDir,
    srcDir: scanDirs.srcDir,
    schemaFile: schemaFile === '' ? undefined : schemaFile,
  };

  // ---------------- Main Logic ----------------

  // A configuration value the run cannot use is a broken run, like a missing
  // directory: exit 2 with the reason, never a stack trace. Both the verbose
  // lines and the scan resolve the same configured patterns, so both go
  // through this; --verbose used to turn the clean exit into a raw throw that
  // cli.ts printed as a trace.
  const orExitTwo = <T>(read: () => T): T => {
    try {
      return read();
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(kleur.red(error.message));
        process.exit(2);
      }
      throw error;
    }
  };

  if (verbose) {
    // Report what was configured, then what any glob among it expanded to.
    logVerbose(
      orExitTwo(() =>
        formatVerboseConfigLines({
          ...config,
          graphqlDir: graphqlDirs,
          srcDir: srcDirs,
        }),
      ),
    );
    logVerbose([
      ...formatExpandedDirLines('graphqlDir', graphqlDirs, scanDirs.graphqlDir),
      ...formatExpandedDirLines('srcDir', srcDirs, scanDirs.srcDir),
    ]);
  }

  // Build the schema here rather than inside the scan: a schema the user asked
  // for but that cannot be read or parsed is a broken run (exit 2), like a
  // missing directory, not a silently skipped check. A schema derived from a
  // codegen config is the opposite case: the user never asked for the check, so
  // it is skipped with a warning and the scan continues.
  let schema: GraphQLSchema | undefined;
  if (schemaFile !== '') {
    const derivedSchema = codegenSource(run, 'schemaFile');
    try {
      const built = buildSchema(fs.readFileSync(schemaFile, 'utf-8'));
      // buildSchema only runs the SDL-level rules. Whether the result is a
      // usable schema (a Query root, resolvable type references) is asserted
      // later, inside graphql's validate, which runs deep in the scan outside
      // any handler. Asking here keeps both failures on this one path, and
      // assigning only afterwards keeps an invalid schema out of the scan.
      assertValidSchema(built);
      schema = built;
    } catch (e) {
      if (derivedSchema === undefined) {
        console.error(
          kleur.red(
            `Could not read or parse the GraphQL schema file: ${schemaFile}.`,
          ),
        );
        // The reason, not the stack: this is a configuration problem the user
        // can fix, not a crash they should have to read a trace to understand.
        console.error(kleur.red(e instanceof Error ? e.message : String(e)));
        process.exit(2);
      }
      configWarnings.push(
        formatDerivedSchemaWarning(derivedSchema, schemaFile),
      );
    }
  }

  const result = orExitTwo(() => scanProject(config, schema));
  const {
    gqlFileCount,
    sourceFileCount,
    operationCount,
    inlineDocumentCount,
    deprecatedUsages,
    duplicateWarnings,
    generatedWarnings,
    readWarnings,
  } = result;
  // The gate decides what is reported, and reporting is what sets the exit
  // code: a CI job can fail on high-confidence findings alone while a local run
  // still reviews the rest. Without it every finding is reported, as before.
  const unusedOperations = filterByConfidence(
    result.unusedOperations,
    minConfidence,
  );
  const unusedFragments = filterByConfidence(
    result.unusedFragments,
    minConfidence,
  );
  const orphanedFiles = filterByConfidence(result.orphanedFiles, minConfidence);
  const unusedFieldCandidates = filterByConfidence(
    result.unusedFieldCandidates,
    minConfidence,
  );
  // Absent (not empty) in the JSON when the check is off, so a consumer can
  // tell "nothing found" from "never looked".
  const fieldCandidates = resolveCheckFields(config)
    ? unusedFieldCandidates
    : undefined;
  // All advisory warnings share one pipeline: stderr lines (or ::warning in
  // annotate mode) plus the JSON report's `warnings` array.
  // A scan that read no source file cannot tell "nothing references these" from
  // "nothing was read", and every operation grades high with reason
  // name-absent. Say so, loudly, rather than reporting a confident sweep.
  if (sourceFileCount === 0) {
    readWarnings.push(
      `No source files were read from ${scanDirs.srcDir.join(', ')}. ` +
        'Every operation will look unused. Check the directory, and set ' +
        '"sourceExtensions" if this project uses extensions gqlPrune does not ' +
        `scan by default (${DEFAULT_SOURCE_EXTENSIONS.join(', ')}).`,
    );
  }

  const advisoryWarnings = [
    ...configWarnings,
    ...duplicateWarnings,
    ...generatedWarnings,
    ...readWarnings,
  ];

  if (verbose) {
    logVerbose(formatVerboseScanLines(result));
    logVerbose(formatVerboseFieldLines(result.fieldTraces));
    // From the unfiltered scan, so a gated run still explains what it hid.
    logVerbose(formatVerboseConfidenceLines(result));
  }

  // Never leave an inferred setting invisible: name the file it came from. In
  // --json mode stdout is the report and nothing else, so the notice goes to
  // stderr there, alongside the verbose lines and the advisory warnings. It is
  // provenance rather than a problem, so it stays out of the JSON `warnings`
  // array, and out of the ::warning annotations under --annotate.
  if (run.codegen !== undefined) {
    const notice = kleur.dim(formatCodegenInfoLine(run.codegen));
    if (json) {
      console.error(notice);
    } else {
      console.log(notice);
    }
  }

  if (!json) {
    console.log(
      `Found ${kleur.yellow(gqlFileCount.toString())} ${pluralize(gqlFileCount, 'GraphQL file')}.`,
    );
    console.log(
      `Found ${kleur.yellow(operationCount.toString())} ${pluralize(operationCount, 'GraphQL operation')}.`,
    );
    console.log(
      `Found ${kleur.yellow(sourceFileCount.toString())} ${pluralize(sourceFileCount, 'source file')}.`,
    );
    if (result.inline) {
      console.log(
        `Found ${kleur.yellow(inlineDocumentCount.toString())} ${pluralize(inlineDocumentCount, 'inline GraphQL document')}.`,
      );
    }
  }

  // Warn when a single file references most operations (e.g. un-excluded codegen
  // output): it would silently make every operation look "used" and report
  // nothing unused. Emit to stderr so it surfaces in --json mode too without
  // corrupting the JSON on stdout.
  advisoryWarnings.forEach(printAdvisory);

  // GitHub Actions annotations go to stderr, keeping stdout clean for --json.
  if (annotate) {
    for (const line of formatAnnotations(
      unusedOperations,
      unusedFragments,
      orphanedFiles,
      deprecatedUsages,
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
          deprecatedUsages,
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

  const nothingUnused =
    unusedOperations.length === 0 && unusedFragments.length === 0;
  if (nothingUnused) {
    console.log(
      kleur.green('\n✓ No unused GraphQL operations or fragments found.'),
    );
  } else {
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
  }

  // Advisory, so it prints after the unused sections (and after the all-clear
  // line) and never carries the exit code on its own.
  if (deprecatedUsages.length > 0) {
    reportDeprecatedUsages(deprecatedUsages);
  }
  // Advisory too, and last of the sections. Its caveat covers only what is
  // specific to fields; the closing reminder below qualifies it like every
  // other candidate section.
  if (unusedFieldCandidates.length > 0) {
    reportUnusedFieldCandidates(unusedFieldCandidates);
  }

  // Closes any report that named a candidate: all of it comes from a string
  // search. Field candidates count, which is why this is not tied to the exit
  // code; deprecated selections do not, because the schema proves those. The
  // all-clear path has nothing to qualify, so it stays silent.
  if (!nothingUnused || unusedFieldCandidates.length > 0) {
    console.log(kleur.dim(CANDIDATE_REMINDER));
  }

  // Use exitCode (not process.exit) so all report output flushes before exit.
  if (!nothingUnused) {
    process.exitCode = 1;
  }
}
