// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as path from 'path';
import {
  ConfidenceGrade,
  ConfidenceLevel,
  ConfidenceReason,
} from '../types/Confidence.js';
import { FragmentInfo } from '../types/FragmentInfo.js';
import { OperationInfo } from '../types/OperationInfo.js';
import { UnusedFieldInfo } from '../types/UnusedFieldInfo.js';
import { SourceFile } from './fileUtils.js';
import { wholeWordPattern } from './stringHelpers.js';

/** Every grade, strongest first. Also the accepted `minConfidence` values. */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

/** Order the levels compare in; higher means stronger evidence of dead code. */
const RANK: Record<ConfidenceLevel, number> = { high: 3, medium: 2, low: 1 };

/** The evidence behind each reason, in words, for `--verbose`. */
const REASON_TEXT: Record<ConfidenceReason, string> = {
  'name-absent': 'the name appears in no scanned source file',
  'generated-only': 'the name appears only in files that look generated',
  'source-mention':
    'the name appears in ordinary source, but never through a usage pattern',
  'heuristic-cap':
    'the field check cannot see a read through a rename, a spread, or a computed key',
};

/** An unused operation with its grade. */
export type GradedOperation = OperationInfo & ConfidenceGrade;

/** An unused fragment with its grade. */
export type GradedFragment = FragmentInfo & ConfidenceGrade;

/** A field candidate with its grade, which never exceeds `medium`. */
export type GradedField = UnusedFieldInfo & ConfidenceGrade;

/** An orphaned file with the lowest grade among the definitions it holds. */
export type OrphanedFile = { file: string } & ConfidenceGrade;

/** Narrows a raw config or CLI value to a grade. */
export function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return (CONFIDENCE_LEVELS as readonly unknown[]).includes(value);
}

/**
 * Grades a definition name by how much corroborating evidence there is that
 * something references it anyway. The scan itself only searches the
 * pattern-expanded strings (`useGetUserQuery`, `GetUserDocument`); this searches
 * the bare name as a whole word, which is what separates "nothing in the source
 * knows this name" from "something mentions it, just not the way we expect".
 *
 * @param {string} name - The definition name, searched as a whole word.
 * @param {SourceFile[]} sources - The already-read source files.
 * @param {ReadonlySet<string>} generatedFiles - Paths of suspected generated files.
 * @returns {ConfidenceGrade} - The grade and the evidence behind it.
 */
export function gradeName(
  name: string,
  sources: SourceFile[],
  generatedFiles: ReadonlySet<string>,
): ConfidenceGrade {
  const pattern = wholeWordPattern(name);
  const mentions = sources.filter((source) => pattern.test(source.content));
  if (mentions.length === 0) {
    return { confidence: 'high', reason: 'name-absent' };
  }
  return mentions.every((source) => generatedFiles.has(source.file))
    ? { confidence: 'medium', reason: 'generated-only' }
    : { confidence: 'low', reason: 'source-mention' };
}

/**
 * Lowers a grade to `max` when the evidence claims more than the detection can
 * support, recording `heuristic-cap` as the reason. A grade already at or below
 * the cap passes through untouched.
 */
export function capConfidence(
  grade: ConfidenceGrade,
  max: ConfidenceLevel,
): ConfidenceGrade {
  return RANK[grade.confidence] <= RANK[max]
    ? grade
    : { confidence: max, reason: 'heuristic-cap' };
}

/**
 * The weakest of a set of grades. An empty set grades `high`, which only
 * happens where there is nothing to weaken the verdict.
 */
export function lowestConfidence(grades: ConfidenceGrade[]): ConfidenceGrade {
  return grades.reduce<ConfidenceGrade>(
    (lowest, grade) =>
      RANK[grade.confidence] < RANK[lowest.confidence] ? grade : lowest,
    { confidence: 'high', reason: 'name-absent' },
  );
}

/** Whether a grade passes the `minConfidence` gate; no minimum keeps it. */
export function meetsMinConfidence(
  level: ConfidenceLevel,
  min: ConfidenceLevel | undefined,
): boolean {
  return min === undefined || RANK[level] >= RANK[min];
}

/** Keeps the findings graded at or above `min`; no minimum keeps them all. */
export function filterByConfidence<T extends ConfidenceGrade>(
  findings: readonly T[],
  min: ConfidenceLevel | undefined,
): T[] {
  return findings.filter((finding) =>
    meetsMinConfidence(finding.confidence, min),
  );
}

/** Counts the findings per level, for the JSON report's `summary`. */
export function countByConfidence(
  findings: readonly ConfidenceGrade[],
): Record<ConfidenceLevel, number> {
  const counts: Record<ConfidenceLevel, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const finding of findings) counts[finding.confidence] += 1;
  return counts;
}

/** Renders a grade as `level (reason: evidence)` for `--verbose`. */
export function describeConfidence(grade: ConfidenceGrade): string {
  return `${grade.confidence} (${grade.reason}: ${REASON_TEXT[grade.reason]})`;
}

/** Grades every unused operation by its bare name. */
export function gradeOperations(
  operations: OperationInfo[],
  sources: SourceFile[],
  generatedFiles: ReadonlySet<string>,
): GradedOperation[] {
  return operations.map((operation) => ({
    ...operation,
    ...gradeName(operation.name, sources, generatedFiles),
  }));
}

/** Grades every unused fragment by its bare name. */
export function gradeFragments(
  fragments: FragmentInfo[],
  sources: SourceFile[],
  generatedFiles: ReadonlySet<string>,
): GradedFragment[] {
  return fragments.map((fragment) => ({
    ...fragment,
    ...gradeName(fragment.name, sources, generatedFiles),
  }));
}

/**
 * Grades every field candidate, capped at `medium`. The candidates come from a
 * name-absence heuristic that cannot see a field read through a rename, a
 * spread, or a computed key, so however absent the name is, calling one of them
 * high confidence would claim more than the check can know.
 */
export function gradeFieldCandidates(
  candidates: UnusedFieldInfo[],
  sources: SourceFile[],
  generatedFiles: ReadonlySet<string>,
): GradedField[] {
  return candidates.map((candidate) => ({
    ...candidate,
    ...capConfidence(
      gradeName(candidate.field, sources, generatedFiles),
      'medium',
    ),
  }));
}

/**
 * Grades every orphaned file by the lowest grade among the definitions it
 * holds: one definition that still looks live undermines the whole-file
 * verdict, whatever the others say.
 *
 * @param {string[]} orphanedFiles - The orphaned files, in scan order.
 * @param {GradedOperation[]} operations - Every graded unused operation.
 * @param {GradedFragment[]} fragments - Every graded unused fragment.
 * @returns {OrphanedFile[]} - One graded entry per orphaned file.
 */
export function gradeOrphanedFiles(
  orphanedFiles: string[],
  operations: GradedOperation[],
  fragments: GradedFragment[],
): OrphanedFile[] {
  // Paths reach this from different sources ('./g/a.gql' vs 'g/a.gql'), so
  // compare them resolved, the way the orphan detection itself does.
  const gradesByFile = new Map<string, ConfidenceGrade[]>();
  for (const definition of [...operations, ...fragments]) {
    const key = path.resolve(definition.filePath);
    gradesByFile.set(key, [
      ...(gradesByFile.get(key) ?? []),
      { confidence: definition.confidence, reason: definition.reason },
    ]);
  }
  return orphanedFiles.map((file) => ({
    file,
    ...lowestConfidence(gradesByFile.get(path.resolve(file)) ?? []),
  }));
}
