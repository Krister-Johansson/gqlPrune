// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  findGroupEnd,
  findInterpolationEnd,
  isQuote,
  readString,
  scanLiteral,
  skipBlockComment,
  skipLineComment,
  skipLiteral,
  skipTrivia,
} from '../src/utils/jsLexer';

describe('jsLexer', () => {
  describe('isQuote', () => {
    it('recognizes the three quote characters and nothing else', () => {
      expect(isQuote("'")).toBe(true);
      expect(isQuote('"')).toBe(true);
      expect(isQuote('`')).toBe(true);
      expect(isQuote('/')).toBe(false);
      expect(isQuote(undefined)).toBe(false);
    });
  });

  describe('skipLineComment', () => {
    it('returns the offset of the newline that ends the comment', () => {
      const text = 'a // note\nb';
      expect(skipLineComment(text, 2)).toBe(9);
      expect(text[9]).toBe('\n');
    });

    it('runs to the end of the file when there is no newline', () => {
      expect(skipLineComment('a // note', 2)).toBe(9);
    });
  });

  describe('skipBlockComment', () => {
    it('returns the offset just past the closing marker', () => {
      const text = 'a /* x */ b';
      expect(skipBlockComment(text, 2)).toBe(9);
      expect(text.slice(9)).toBe(' b');
    });

    it('runs to the end of the file when the comment never closes', () => {
      expect(skipBlockComment('a /* open', 2)).toBe(9);
    });
  });

  describe('skipTrivia', () => {
    it('steps over whitespace and both comment forms', () => {
      const text = '  // c\n /* d */ \n x';
      expect(text[skipTrivia(text, 0)]).toBe('x');
    });

    it('returns the same offset when there is nothing to skip', () => {
      expect(skipTrivia('x', 0)).toBe(0);
    });

    it('returns the length when only trivia remains', () => {
      expect(skipTrivia('  // tail', 0)).toBe(9);
    });
  });

  describe('skipLiteral', () => {
    it('returns the offset just past a quoted string', () => {
      expect(skipLiteral(`'a' b`, 0)).toBe(3);
      expect(skipLiteral(`"a" b`, 0)).toBe(3);
    });

    it('steps over an escaped quote', () => {
      expect(skipLiteral(`'a\\'b' c`, 0)).toBe(6);
    });

    it('ends a single-line literal at a newline without consuming it', () => {
      const text = `'open\nnext`;
      expect(skipLiteral(text, 0)).toBe(5);
      expect(text[5]).toBe('\n');
    });

    it('lets a template literal cross lines', () => {
      expect(skipLiteral('`a\nb` c', 0)).toBe(5);
    });

    it('skips an interpolation as a unit, whatever braces it holds', () => {
      const text = '`${ {a: 1} }` after';
      expect(skipLiteral(text, 0)).toBe(13);
    });

    it('steps over an escaped backtick after an interpolation', () => {
      // The case the two lexers used to disagree on: one copy had no
      // interpolation branch, so the closing backtick was found early and the
      // rest of the line read as code.
      const text = '`${x} \\` still inside` after';
      expect(skipLiteral(text, 0)).toBe(22);
      expect(text.slice(22)).toBe(' after');
    });

    it('runs to the end of the file when the literal never closes', () => {
      expect(skipLiteral('`open', 0)).toBe(5);
      expect(skipLiteral('`${open', 0)).toBe(7);
    });
  });

  describe('findInterpolationEnd', () => {
    it('returns the offset just past the closing brace', () => {
      expect(findInterpolationEnd('${a}b', 0)).toBe(4);
    });

    it('counts nested braces', () => {
      expect(findInterpolationEnd('${ {a: {b: 1}} }c', 0)).toBe(16);
    });

    it('returns null when the interpolation never closes', () => {
      expect(findInterpolationEnd('${a', 0)).toBeNull();
    });
  });

  describe('scanLiteral', () => {
    it('finds the closing quote and collects the interpolations', () => {
      const text = 'query ${A} and ${B}` tail';
      expect(scanLiteral(text, 0, '`')).toEqual({
        bodyEnd: 19,
        interpolations: [
          { start: 6, end: 10 },
          { start: 15, end: 19 },
        ],
      });
    });

    it('returns null for a quoted argument that crosses a line', () => {
      expect(scanLiteral('a\nb"', 0, '"')).toBeNull();
    });

    it('returns null when the literal or an interpolation never closes', () => {
      expect(scanLiteral('open', 0, '`')).toBeNull();
      expect(scanLiteral('${open`', 0, '`')).toBeNull();
    });
  });

  describe('readString', () => {
    it('returns the unescaped value and the offset past the closing quote', () => {
      expect(readString(`'a\\'b' c`, 0)).toEqual({ value: "a'b", end: 6 });
      expect(readString('"x"', 0)).toEqual({ value: 'x', end: 3 });
    });

    it('reads a template literal without interpolations', () => {
      expect(readString('`src/**`', 0)).toEqual({ value: 'src/**', end: 8 });
    });

    it('returns null for an interpolated template', () => {
      expect(readString('`${root}/src`', 0)).toBeNull();
    });

    it('drops a line continuation, as JavaScript does', () => {
      // A backslash before a line terminator removes both characters from
      // the value; keeping the newline would produce a glob that matches
      // nothing. Every terminator JavaScript recognizes counts.
      expect(readString("'src/\\\n**'", 0)).toEqual({
        value: 'src/**',
        end: 10,
      });
      expect(readString("'a\\\r\nb'", 0)).toEqual({ value: 'ab', end: 7 });
      expect(readString("'a\\\rb'", 0)).toEqual({ value: 'ab', end: 6 });
      expect(readString("'a\\\u2028b'", 0)).toEqual({ value: 'ab', end: 6 });
      expect(readString("'a\\\u2029b'", 0)).toEqual({ value: 'ab', end: 6 });
    });

    it('returns null when there is no literal at the offset', () => {
      expect(readString('abc', 0)).toBeNull();
    });

    it('returns null for a literal that never closes or crosses a line', () => {
      expect(readString("'open", 0)).toBeNull();
      expect(readString("'a\nb'", 0)).toBeNull();
    });
  });

  describe('findGroupEnd', () => {
    it('returns the offset just past the bracket closing an open group', () => {
      // `start` is inside the group, just after its opening bracket.
      expect(findGroupEnd('(a, b) c', 1, '(', ')')).toBe(6);
    });

    it('counts nested groups of the same kind', () => {
      expect(findGroupEnd('(f(g(1))) c', 1, '(', ')')).toBe(9);
    });

    it('ignores brackets inside strings and comments', () => {
      const text = `(")", /* ) */ // )\n x) tail`;
      expect(text.slice(findGroupEnd(text, 1, '(', ')') ?? 0)).toBe(' tail');
    });

    it('returns null when the group never closes', () => {
      expect(findGroupEnd('(a, b', 1, '(', ')')).toBeNull();
    });

    it('works for braces and square brackets', () => {
      expect(findGroupEnd('{a: [1, 2]} x', 1, '{', '}')).toBe(11);
      expect(findGroupEnd('[1, [2]] x', 1, '[', ']')).toBe(8);
    });
  });
});
