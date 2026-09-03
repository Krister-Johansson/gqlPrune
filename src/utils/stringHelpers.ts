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
 * Escapes a string so it can be used as a literal inside a regular expression.
 *
 * @param {string} value - The literal text to escape.
 * @returns {string} - The escaped text.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
