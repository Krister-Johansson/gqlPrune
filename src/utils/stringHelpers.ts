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
 * Everything JavaScript accepts inside an identifier: the Unicode continue set,
 * plus `$`, `_`, and the two zero-width joiners the spec allows. Written as a
 * character class so it can be dropped into a lookaround.
 */
const IDENTIFIER_CLASS = '[\\p{ID_Continue}$\\u200C\\u200D]';

/** The same set, as a matcher for a single character. */
const IDENTIFIER_CHARACTER = new RegExp(`^${IDENTIFIER_CLASS}$`, 'u');

/**
 * Builds a regular expression that finds `text` only as a whole word.
 *
 * The boundary is every character JavaScript lets an identifier continue with,
 * not `\b`. `\b` is ASCII-only and knows nothing of `$`, so `\bUser\b` matches
 * inside `$User` and inside `\u03C0User`, both of which are different
 * identifiers. Every search over source text shares this definition, so a name
 * means the same thing to detection, confidence grading, the field check and
 * the inline identifier lookup.
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
  const edge = (character: string): boolean =>
    character !== '' && IDENTIFIER_CHARACTER.test(character);
  const before = edge(text[0] ?? '') ? `(?<!${IDENTIFIER_CLASS})` : '';
  const after = edge(text[text.length - 1] ?? '')
    ? `(?!${IDENTIFIER_CLASS})`
    : '';
  return new RegExp(`${before}${body}${after}`, `u${flags ?? ''}`);
}
