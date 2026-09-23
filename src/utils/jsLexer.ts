// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

/**
 * The one JavaScript lexer the textual scanners share: the inline document
 * scanner and the codegen config reader both walk source text deciding what
 * is code, what is a comment and what is a string, and both used to carry
 * their own copy of that decision. The copies drifted, so one lost track of
 * a template literal that escaped a backtick after an interpolation while the
 * other did not. This module is the single definition.
 *
 * It is a lexer of the parts that matter for skipping, not a parser. The blind
 * spot every function here shares: a regular-expression literal holding a
 * quote or a comment marker, such as `/["']/`, is read as the start of a
 * string or comment and can throw the scan off for the rest of the line.
 */

/** A half-open `[start, end)` range of offsets within a source text. */
export type Range = { start: number; end: number };

/** Whether `char` opens a string or template literal. */
export function isQuote(char: string | undefined): boolean {
  return char === "'" || char === '"' || char === '`';
}

/**
 * Returns the offset of the newline that ends the `//` comment starting at
 * `start`, or the text length when the comment runs to the end of the file.
 * The newline itself is left for the caller: it can carry meaning, as it does
 * for statement boundaries in the inline scanner.
 */
export function skipLineComment(text: string, start: number): number {
  const newline = text.indexOf('\n', start + 2);
  return newline === -1 ? text.length : newline;
}

/**
 * Returns the offset just past the block comment starting at `start`. An
 * unterminated comment runs to the end of the file, which is what a compiler
 * sees too, so nothing after it is read as code.
 */
export function skipBlockComment(text: string, start: number): number {
  const end = text.indexOf('*/', start + 2);
  return end === -1 ? text.length : end + 2;
}

/** Skips whitespace and both comment forms, returning the next code offset. */
export function skipTrivia(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const char = text[i];
    if (char === '/' && text[i + 1] === '/') {
      i = skipLineComment(text, i);
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i = skipBlockComment(text, i);
      continue;
    }
    if (!/\s/.test(char)) return i;
    i += 1;
  }
  return i;
}

/**
 * Finds the end of the `${...}` interpolation starting at `start` by counting
 * braces. Returns the offset just past the closing brace, or `null` when it
 * never closes. Braces inside strings within the interpolation are counted
 * like any other; the two scanners have always read them that way.
 */
export function findInterpolationEnd(
  text: string,
  start: number,
): number | null {
  let depth = 1;
  for (let i = start + 2; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

/**
 * Scans a string or template literal from its first body character to its
 * closing quote, collecting the interpolations on the way. Returns `null` when
 * the literal never closes (a quoted argument may not cross a line), so a
 * half-written template is skipped instead of swallowing the rest of the file.
 */
export function scanLiteral(
  text: string,
  bodyStart: number,
  quote: string,
): { bodyEnd: number; interpolations: Range[] } | null {
  const interpolations: Range[] = [];
  let i = bodyStart;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === quote) {
      return { bodyEnd: i, interpolations };
    }
    if (char === '\n' && quote !== '`') {
      return null;
    }
    if (quote === '`' && char === '$' && text[i + 1] === '{') {
      const end = findInterpolationEnd(text, i);
      if (end === null) return null;
      interpolations.push({ start: i, end });
      i = end;
      continue;
    }
    i += 1;
  }
  return null;
}

/**
 * Returns the offset just past the string or template literal opening at
 * `index`, so its contents are never read as code. A `'` or `"` literal cannot
 * cross a line, so a newline ends it and scanning resumes there; a template
 * literal runs to its closing backtick, with `${...}` skipped as a unit by
 * brace counting so a brace-heavy interpolation cannot end it early. A literal
 * that never closes runs to the end of the text.
 */
export function skipLiteral(text: string, index: number): number {
  const quote = text[index];
  let i = index + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === quote) return i + 1;
    if (char === '\n' && quote !== '`') return i;
    if (quote === '`' && char === '$' && text[i + 1] === '{') {
      const end = findInterpolationEnd(text, i);
      if (end === null) return text.length;
      i = end;
      continue;
    }
    i += 1;
  }
  return text.length;
}

/**
 * Reads the string literal at `index`. Returns `null` when there is none, when
 * it never closes, or when it interpolates: `` `${root}/src/**` `` has no value
 * that can be known without running the file, so it is simply not extracted.
 */
export function readString(
  text: string,
  index: number,
): { value: string; end: number } | null {
  const quote = text[index];
  if (!isQuote(quote)) return null;
  let value = '';
  let i = index + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      value += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (char === quote) return { value, end: i + 1 };
    if (char === '\n' && quote !== '`') return null;
    if (quote === '`' && char === '$' && text[i + 1] === '{') return null;
    value += char;
    i += 1;
  }
  return null;
}

/**
 * Returns the offset just past the `close` bracket that ends a group already
 * open at `start` (the offset right after its `open` bracket). Nested groups
 * of the same kind, strings and comments inside it are stepped over. Returns
 * `null` when the group never closes.
 */
export function findGroupEnd(
  text: string,
  start: number,
  open: string,
  close: string,
): number | null {
  let depth = 1;
  let i = start;
  while (i < text.length) {
    const char = text[i];
    if (char === '/' && text[i + 1] === '/') {
      i = skipLineComment(text, i);
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      i = skipBlockComment(text, i);
      continue;
    }
    if (isQuote(char)) {
      i = skipLiteral(text, i);
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return null;
}
