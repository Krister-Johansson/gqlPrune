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
 * - `name-absent`: the bare name appears in no scanned source file.
 * - `generated-only`: it appears only in files that look generated.
 * - `source-mention`: it appears in ordinary source, but never in a form a
 *   usage pattern recognizes.
 * - `heuristic-cap`: the detection itself is too weak for the grade the
 *   evidence would otherwise give (see the field candidates).
 */
export type ConfidenceReason =
  'name-absent' | 'generated-only' | 'source-mention' | 'heuristic-cap';

/** The grade carried by every finding gqlPrune reports as a candidate. */
export interface ConfidenceGrade {
  confidence: ConfidenceLevel;
  reason: ConfidenceReason;
}
