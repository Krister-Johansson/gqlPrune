// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

/**
 * How much corroborating evidence there is that a finding is referenced
 * somewhere after all: `high` means no trace of the name was found anywhere in
 * the scanned source, `low` means something in ordinary source mentions it.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * The evidence behind a grade.
 *
 * - `name-absent`: the bare name appears in no scanned source file, neither
 *   as an identifier nor inside a string.
 * - `generated-only`: it appears only in files that look generated.
 * - `name-referenced`: an identifier with exactly this name appears in
 *   ordinary source, but nothing that resolves to a usage pattern; an unknown
 *   convention or a dynamic lookup is plausible.
 * - `string-mention`: the name appears inside a string in ordinary source,
 *   which may be a reference built at runtime.
 * - `heuristic-cap`: the detection itself is too weak for the grade the
 *   evidence would otherwise give: a field candidate matched by name because
 *   its operation had no call site to trace.
 * - `never-read`: a field candidate whose operation was traced from every
 *   call site, with no read path reaching the field.
 */
export type ConfidenceReason =
  | 'name-absent'
  | 'generated-only'
  | 'name-referenced'
  | 'string-mention'
  | 'heuristic-cap'
  | 'never-read';

/** The grade carried by every finding gqlPrune reports as a candidate. */
export interface ConfidenceGrade {
  confidence: ConfidenceLevel;
  reason: ConfidenceReason;
}
