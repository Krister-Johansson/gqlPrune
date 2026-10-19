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
import type { ReferenceIndex } from './referenceIndex.js';

/** Every grade, strongest first. Also the accepted `minConfidence` values. */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

/** Order the levels compare in; higher means stronger evidence of dead code. */
const RANK: Record<ConfidenceLevel, number> = { high: 3, medium: 2, low: 1 };

/** The evidence behind each reason, in words, for `--verbose`. */
const REASON_TEXT: Record<ConfidenceReason, string> = {
  'name-absent': 'the name appears in no scanned source file',
  'generated-only': 'the name appears only in files that look generated',
  'name-referenced':
    'an identifier with this exact name appears in ordinary source, but nothing that resolves to a usage pattern',
  'string-mention':
    'the name appears inside a string in ordinary source, which may be a reference built at runtime',
  'heuristic-cap':
    'no call site of the operation could be traced, so the field was matched by name, which cannot see a read through a rename, a spread, or a computed key',
  'never-read':
    'every call site of the operation was traced and no read reaches this field',
};

/** An unused operation with its grade. */
export type GradedOperation = OperationInfo & ConfidenceGrade;

/** An unused fragment with its grade. */
export type GradedFragment = FragmentInfo & ConfidenceGrade;

/** A field candidate with its grade; the trace flag behind the grade is dropped. */
export type GradedField = Omit<UnusedFieldInfo, 'traced'> & ConfidenceGrade;

/** An orphaned file with the lowest grade among the definitions it holds. */
export type OrphanedFile = { file: string } & ConfidenceGrade;

/** Narrows a raw config or CLI value to a grade. */
export function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return (CONFIDENCE_LEVELS as readonly unknown[]).includes(value);
}

/**
 * Grades a definition name by how much corroborating evidence there is that
 * something references it anyway. The usage verdict only looks for bindings
 * that resolve to a usage pattern (`useGetUserQuery`, `GetUserDocument`); this
 * looks for the bare name, which is what separates "nothing in the source
 * knows this name" from "something mentions it, just not the way we expect".
 * The engine tells an identifier from a string, so the two kinds of mention
 * get their own reasons: a dynamic lookup by string and an unknown naming
 * convention call for different checks.
 *
 * @param {string} name - The definition name.
 * @param {ReferenceIndex} index - The resolved references of the scanned sources.
 * @param {ReadonlySet<string>} generatedFiles - Paths of suspected generated files.
 * @returns {ConfidenceGrade} - The grade and the evidence behind it.
 */
export function gradeName(
  name: string,
  index: ReferenceIndex,
  generatedFiles: ReadonlySet<string>,
): ConfidenceGrade {
  let mentioned = false;
  let ordinaryIdentifier = false;
  let ordinaryString = false;
  for (const path of index.files) {
    const asIdentifier = index.identifiersByFile.get(path)?.has(name) ?? false;
    const asString = index.stringWordsByFile.get(path)?.has(name) ?? false;
    if (!asIdentifier && !asString) continue;
    mentioned = true;
    if (generatedFiles.has(index.displayName(path))) continue;
    if (asIdentifier) ordinaryIdentifier = true;
    if (asString) ordinaryString = true;
  }
  if (!mentioned) return { confidence: 'high', reason: 'name-absent' };
  if (ordinaryIdentifier)
    return { confidence: 'low', reason: 'name-referenced' };
  if (ordinaryString) return { confidence: 'low', reason: 'string-mention' };
  return { confidence: 'medium', reason: 'generated-only' };
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
  index: ReferenceIndex,
  generatedFiles: ReadonlySet<string>,
): GradedOperation[] {
  return operations.map((operation) => ({
    ...operation,
    ...gradeName(operation.name, index, generatedFiles),
  }));
}

/** Grades every unused fragment by its bare name. */
export function gradeFragments(
  fragments: FragmentInfo[],
  index: ReferenceIndex,
  generatedFiles: ReadonlySet<string>,
): GradedFragment[] {
  return fragments.map((fragment) => ({
    ...fragment,
    ...gradeName(fragment.name, index, generatedFiles),
  }));
}

/**
 * Grades every field candidate by how its operation was judged. A traced
 * candidate grades `high` (`never-read`): every call site of its operation was
 * followed and no read reaches the field, while anything the trace lost track
 * of already counted as read. A candidate matched by name grades `medium`
 * (`heuristic-cap`): its name appears nowhere, which grades an operation
 * `high`, but a name search cannot see a field read through a rename, a
 * spread or a computed key, so calling it high would claim more than the
 * check can know.
 *
 * @param {UnusedFieldInfo[]} candidates - The field candidates to grade.
 * @returns {GradedField[]} - The same candidates, graded, without the trace flag.
 */
export function gradeFieldCandidates(
  candidates: UnusedFieldInfo[],
): GradedField[] {
  return candidates.map(({ traced, ...candidate }) => ({
    ...candidate,
    ...(traced
      ? { confidence: 'high', reason: 'never-read' }
      : { confidence: 'medium', reason: 'heuristic-cap' }),
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
