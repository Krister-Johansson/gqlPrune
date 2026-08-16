// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

/**
 * Capitalizes the first letter of a given string.
 *
 * @param {string} string - The input string.
 * @returns {string} - The input string with its first letter capitalized.
 */
export function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * Picks the singular or plural form for a count, so a report of one finding
 * never reads as "1 field candidates".
 *
 * @param {number} count - How many of the thing there are.
 * @param {string} singular - The form to use for exactly one.
 * @param {string} [plural] - The plural form, when appending "s" is wrong.
 * @returns {string} - The form matching the count.
 */
export function pluralize(
  count: number,
  singular: string,
  plural?: string,
): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/**
 * Escapes a string so it can be used as a literal inside a regular expression.
 *
 * @param {string} value - The literal text to escape.
 * @returns {string} - The escaped text.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
