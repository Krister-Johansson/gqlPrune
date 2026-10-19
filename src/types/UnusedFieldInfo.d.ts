// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

/** Where a response key is selected: the GraphQL file and, when known, the line. */
export interface FieldLocation {
  file: string;
  line?: number;
}

/**
 * A response key a used operation selects (directly or through a fragment it
 * spreads) that nothing in the scanned source appears to read: a candidate
 * for over-fetching, not proof of it.
 */
export interface UnusedFieldInfo {
  /** The operation that selects it. */
  operation: string;
  /** Response keys from the operation's root, joined with dots: `user.address.city`. */
  path: string;
  /** The last response key of the path: the alias when the field is aliased. */
  field: string;
  /** Every place the key is selected for this operation, in first-seen order. */
  locations: FieldLocation[];
  /**
   * True when every call site of the operation was traced and no read path
   * reaches the field; false when the operation fell back to matching the key
   * by name. Decides the grade, and is not part of the report.
   */
  traced: boolean;
}
