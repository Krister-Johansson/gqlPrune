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

/**
 * Builds a regular expression that finds `text` only as a whole word.
 *
 * The boundary is `[\w$]`, not `\b`, because `$` is a legal identifier
 * character in JavaScript: `\bUser\b` matches inside `$User`, which is a
 * different identifier. Every search over source text shares this definition,
 * so a name means the same thing to detection, confidence grading, the field
 * check and the inline identifier lookup.
 *
 * A boundary is only asserted where the pattern's own edge is a word character.
 * A pattern such as `graphql({Name})` ends in a parenthesis, and demanding a
 * non-word character after it would be asserting something about the code that
 * has nothing to do with the name.
 *
 * @param {string} text - The literal text to find.
 * @param {string} [flags] - Regular expression flags, e.g. `g`.
 * @returns {RegExp} - A matcher for `text` as a whole word.
 */
export function wholeWordPattern(text: string, flags?: string): RegExp {
  const body = escapeRegExp(text);
  const before = /[\w$]/.test(text[0] ?? '') ? '(?<![\\w$])' : '';
  const after = /[\w$]/.test(text[text.length - 1] ?? '') ? '(?![\\w$])' : '';
  return new RegExp(`${before}${body}${after}`, flags);
}
