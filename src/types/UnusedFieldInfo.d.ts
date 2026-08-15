// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

/** Where a response key is selected: the GraphQL file and, when known, the line. */
export interface FieldLocation {
  file: string;
  line?: number;
}

/**
 * A response key selected by a used operation (or by a fragment such an
 * operation reaches) whose name appears nowhere in the scanned source: a
 * candidate for over-fetching, not proof of it.
 */
export interface UnusedFieldInfo {
  /** The response key: the alias when the field is aliased, else its name. */
  field: string;
  /** Every place the key is selected, in first-seen order. */
  locations: FieldLocation[];
}
