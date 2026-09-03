// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { DocumentNode, parse, Source } from 'graphql';
import { SourceFile } from './fileUtils.js';
import { escapeRegExp } from './fields.js';
import { buildGraphqlEntities, GraphqlFileEntities } from './operations.js';

/** A half-open `[start, end)` range of offsets within a source file. */
type Range = { start: number; end: number };

/** One recognized inline GraphQL document, before it is parsed. */
export type InlineSite = {
  /** The document text, with every `${...}` interpolation blanked out. */
  body: string;
  /** The 1-based line the body starts on within the source file. */
  line: number;
  /** The 1-based column the body starts on. */
  column: number;
  /** The constant the document is assigned to, when the statement declares one. */
  identifier?: string;
  /**
   * The parts of the file to blank when building the usage corpus: the whole
   * defining statement, minus the interpolations (whose names are real
   * references to other documents and must stay searchable).
   */
  blankRanges: Range[];
};

/** One inline GraphQL document that parsed successfully. */
export type InlineDocument = {
  /** The source file the document was found in. */
  filePath: string;
  /** The constant the document is assigned to, when the statement declares one. */
  identifier?: string;
  /** The parsed document, located against the source file's real lines. */
  document: DocumentNode;
};

/** What one source file contributed to the inline scan. */
export type InlineExtraction = {
  file: string;
  documents: InlineDocument[];
  /** Recognized bodies that failed to parse and were skipped. */
  skipped: number;
  /** The file text with every recognized document blanked out. */
  blankedContent: string;
};

/** An inline document kept alive by a reference to the constant it is assigned to. */
export type InlineIdentifierUsage = {
  identifier: string;
  /** The first source file that references the constant. */
  file: string;
  /** Names of the operations the document defines. */
  operations: string[];
  /** Names of the fragments the document defines. */
  fragments: string[];
};

/**
 * Start of an inline document: an optional `const|let|var IDENT =` (an `export`
 * in front and a type annotation after the name are both fine), then the `gql`
 * or `graphql` tag, possibly reached through a member expression, and then
 * either a backtick (tagged template) or a parenthesis and the opening quote of
 * a single string argument. The lookarounds keep `mygql` and `graphqlDir` out.
 *
 * Sticky, because the scanner only ever tries it at an offset it has already
 * decided is code rather than a comment or a string.
 */
const DOCUMENT_START =
  /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]*)?=\s*)?(?<![\w$])(?:[A-Za-z_$][\w$]*\.)?(?:gql|graphql)(?![\w$])\s*(\()?\s*(['"`])/y;

/** First character of a JavaScript identifier, where a tag can begin. */
const IDENTIFIER_START = /[A-Za-z_$]/;

/** Any character that can continue a JavaScript identifier. */
const IDENTIFIER_PART = /[\w$]/;

/** Replaces every character of a range with a space, keeping newlines in place. */
function blankRange(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * Finds the end of a `${...}` interpolation that starts at `start`, by counting
 * braces. Returns the offset just past the closing brace, or `null` when it
 * never closes.
 */
function findInterpolationEnd(content: string, start: number): number | null {
  let depth = 1;
  for (let i = start + 2; i < content.length; i++) {
    if (content[i] === '{') depth += 1;
    else if (content[i] === '}') {
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
function scanLiteral(
  content: string,
  bodyStart: number,
  quote: string,
): { bodyEnd: number; interpolations: Range[] } | null {
  const interpolations: Range[] = [];
  let i = bodyStart;
  while (i < content.length) {
    const char = content[i];
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
    if (quote === '`' && char === '$' && content[i + 1] === '{') {
      const end = findInterpolationEnd(content, i);
      if (end === null) return null;
      interpolations.push({ start: i, end });
      i = end;
      continue;
    }
    i += 1;
  }
  return null;
}

/** Returns the offset of the newline that ends a `//` comment, or the file end. */
function skipLineComment(content: string, start: number): number {
  const newline = content.indexOf('\n', start + 2);
  return newline === -1 ? content.length : newline;
}

/**
 * Returns the offset just past the end of a block comment. An unterminated
 * comment runs to the end of the file, which is what a compiler
 * sees too, so nothing after it is read as code.
 */
function skipBlockComment(content: string, start: number): number {
  const end = content.indexOf('*/', start + 2);
  return end === -1 ? content.length : end + 2;
}

/**
 * Returns the offset just past an ordinary string or template literal, so its
 * contents are never read as code. A `'` or `"` literal cannot cross a line, so
 * a newline ends it and scanning resumes there; a template literal runs to its
 * closing backtick, with `${...}` skipped as a unit by brace counting so a
 * brace-heavy interpolation cannot end it early.
 */
function skipLiteral(content: string, start: number): number {
  const quote = content[start];
  let i = start + 1;
  while (i < content.length) {
    const char = content[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === quote) return i + 1;
    if (char === '\n' && quote !== '`') return i;
    if (quote === '`' && char === '$' && content[i + 1] === '{') {
      const end = findInterpolationEnd(content, i);
      if (end === null) return content.length;
      i = end;
      continue;
    }
    i += 1;
  }
  return content.length;
}

/**
 * Returns the offset just past the `)` that closes a call whose argument list is
 * already open at `start`, so a helper call carrying options after the document
 * is blanked whole. Nested parentheses, strings and comments inside the
 * arguments are skipped. Returns `null` when the call never closes.
 */
function findCallEnd(content: string, start: number): number | null {
  let depth = 1;
  let i = start;
  while (i < content.length) {
    const char = content[i];
    if (char === '/' && content[i + 1] === '/') {
      i = skipLineComment(content, i);
      continue;
    }
    if (char === '/' && content[i + 1] === '*') {
      i = skipBlockComment(content, i);
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      i = skipLiteral(content, i);
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return null;
}

/** Tracks line/column while walking a file's offsets in ascending order. */
function locationTracker(content: string): (index: number) => {
  line: number;
  column: number;
} {
  let cursor = 0;
  let line = 1;
  let lastNewline = -1;
  return (index) => {
    for (; cursor < index; cursor++) {
      if (content[cursor] === '\n') {
        line += 1;
        lastNewline = cursor;
      }
    }
    return { line, column: index - lastNewline };
  };
}

/**
 * Finds every inline GraphQL document in a source file's text: `gql`/`graphql`
 * tagged templates and `gql(...)`/`graphql(...)` calls taking a single string
 * argument. Purely textual, so it needs no TypeScript program and no schema.
 *
 * Interpolations are blanked out of the returned body (with the same number of
 * characters, so every location still lines up with the file) because
 * graphql-tag and friends append the interpolated documents after the body
 * rather than substituting inside it.
 *
 * A single pass walks the file and keeps track of whether it is in code, a
 * comment, or a string, and only looks for a tag while it is in code. A tag
 * written inside a comment or a quoted string is therefore skipped instead of
 * becoming a phantom document, which matters most for commented-out code. The
 * pass does not parse JavaScript: a regular-expression literal holding a quote
 * or a comment marker, such as `/["']/`, can still throw it off for the rest of
 * the line.
 *
 * @param {string} content - The raw source file text.
 * @returns {InlineSite[]} - The recognized documents, in file order.
 */
export function findInlineDocumentSites(content: string): InlineSite[] {
  const sites: InlineSite[] = [];
  const locate = locationTracker(content);
  let i = 0;
  while (i < content.length) {
    const char = content[i];
    if (char === '/' && content[i + 1] === '/') {
      i = skipLineComment(content, i);
      continue;
    }
    if (char === '/' && content[i + 1] === '*') {
      i = skipBlockComment(content, i);
      continue;
    }
    if (!IDENTIFIER_START.test(char)) {
      // Any other literal belongs to the surrounding code, not to a document.
      i =
        char === "'" || char === '"' || char === '`'
          ? skipLiteral(content, i)
          : i + 1;
      continue;
    }

    DOCUMENT_START.lastIndex = i;
    const match = DOCUMENT_START.exec(content);
    const end =
      match === null ? null : readDocument(content, match, sites, locate);
    if (end !== null) {
      i = end;
      continue;
    }
    // Not a document after all: step over the whole identifier so the text it
    // introduces (a plain string, say) is read in its own right.
    i += 1;
    while (i < content.length && IDENTIFIER_PART.test(content[i])) i += 1;
  }
  return sites;
}

/**
 * Turns one `DOCUMENT_START` match into a site and appends it, returning the
 * offset just past the defining statement. Returns `null` when the match is not
 * a document after all, either because the tag takes a plain quoted string
 * (`gql'...'` is not a tagged template, and `from 'graphql'` is an import) or
 * because the literal never closes.
 */
function readDocument(
  content: string,
  match: RegExpExecArray,
  sites: InlineSite[],
  locate: (index: number) => { line: number; column: number },
): number | null {
  const [matched, identifier, paren, quote] = match;
  if (paren === undefined && quote !== '`') return null;

  const bodyStart = match.index + matched.length;
  const literal = scanLiteral(content, bodyStart, quote);
  if (literal === null) return null;
  const { bodyEnd, interpolations } = literal;

  // The statement ends at the closing quote, plus the rest of the call's
  // argument list when it has one, so that nothing of the definition site is
  // left in the corpus.
  const closing =
    paren === undefined ? null : findCallEnd(content, bodyEnd + 1);
  const end = closing ?? bodyEnd + 1;

  // Everything from the statement's first character to its end is blanked,
  // except the interpolations.
  const blankRanges: Range[] = [];
  let cursor = match.index;
  for (const interpolation of interpolations) {
    blankRanges.push({ start: cursor, end: interpolation.start });
    cursor = interpolation.end;
  }
  blankRanges.push({ start: cursor, end });

  const body = interpolations.reduce(
    (text, interpolation) =>
      text.slice(0, interpolation.start - bodyStart) +
      blankRange(content.slice(interpolation.start, interpolation.end)) +
      text.slice(interpolation.end - bodyStart),
    content.slice(bodyStart, bodyEnd),
  );

  sites.push({
    body,
    ...locate(bodyStart),
    ...(identifier === undefined ? {} : { identifier }),
    blankRanges,
  });
  return end;
}

/**
 * Parses the inline documents of one source file and returns the file text with
 * their defining statements blanked out.
 *
 * The blanked text is what the scan searches for usage. Without it a document
 * would count as its own usage — its GraphQL text and the constant it is
 * assigned to both sit in the very file being searched, which a `.gql` corpus
 * never does. Interpolated names survive the blanking, since `${UserFragmentDoc}`
 * is a genuine reference to another document.
 *
 * A body that does not parse is counted and skipped: a half-written template is
 * a normal state for a file being edited and must never abort the scan.
 *
 * @param {string} filePath - The source file the text came from.
 * @param {string} content - The raw source file text.
 * @returns {InlineExtraction} - Parsed documents, skip count, blanked text.
 */
export function extractInlineDocuments(
  filePath: string,
  content: string,
): InlineExtraction {
  const sites = findInlineDocumentSites(content);
  const documents: InlineDocument[] = [];
  let skipped = 0;

  for (const site of sites) {
    // graphql-js does not apply a Source's locationOffset to token locations,
    // so the body is padded with the newlines and columns that precede it in
    // the file instead. Every reported line then points at the .ts file itself.
    const padded =
      '\n'.repeat(site.line - 1) + ' '.repeat(site.column - 1) + site.body;
    try {
      documents.push({
        filePath,
        ...(site.identifier === undefined
          ? {}
          : { identifier: site.identifier }),
        document: parse(new Source(padded, filePath)),
      });
    } catch {
      skipped += 1;
    }
  }

  const ranges = sites.flatMap((site) => site.blankRanges);
  let blankedContent = content;
  for (const range of ranges) {
    blankedContent =
      blankedContent.slice(0, range.start) +
      blankRange(blankedContent.slice(range.start, range.end)) +
      blankedContent.slice(range.end);
  }

  return { file: filePath, documents, skipped, blankedContent };
}

/**
 * Turns parsed inline documents into the same entity records the file scan
 * produces, so fragments, deprecated selections and field candidates all treat
 * them like any other document. `imports` is always empty: `#import` comments
 * belong to the `.gql` loaders, not to embedded documents.
 *
 * @param {InlineDocument[]} documents - The parsed inline documents.
 * @returns {GraphqlFileEntities[]} - One entry per inline document.
 */
export function toInlineEntities(
  documents: InlineDocument[],
): GraphqlFileEntities[] {
  return documents.map((document) => ({
    ...buildGraphqlEntities(document.document, document.filePath),
    ...(document.identifier === undefined
      ? {}
      : { identifier: document.identifier }),
  }));
}

/**
 * Finds the inline documents whose constant is referenced somewhere in the
 * corpus. This is the signal that makes the client-preset convention work:
 * `const q = graphql(...)` followed by `useQuery(q)` names no operation
 * anywhere, so no usage pattern can ever match it.
 *
 * The corpus passed in has the defining statements blanked out (see
 * {@link extractInlineDocuments}), so a constant only appears here when other
 * code reads it. The match is whole-word, which keeps a one-letter constant
 * from matching the middle of an unrelated word — though a constant named after
 * a common word can still match something unrelated and mask a real finding.
 *
 * @param {GraphqlFileEntities[]} inlineFiles - Entities of the inline documents.
 * @param {SourceFile[]} sources - The blanked source corpus.
 * @returns {InlineIdentifierUsage[]} - One entry per referenced document.
 */
export function findInlineIdentifierUsage(
  inlineFiles: GraphqlFileEntities[],
  sources: SourceFile[],
): InlineIdentifierUsage[] {
  const usages: InlineIdentifierUsage[] = [];
  for (const entities of inlineFiles) {
    const { identifier } = entities;
    if (identifier === undefined) continue;
    const pattern = new RegExp(
      `(?<![\\w$])${escapeRegExp(identifier)}(?![\\w$])`,
    );
    const reference = sources.find((source) => pattern.test(source.content));
    if (reference === undefined) continue;
    usages.push({
      identifier,
      file: reference.file,
      operations: entities.operations.map((operation) => operation.name),
      fragments: entities.fragments.map((fragment) => fragment.name),
    });
  }
  return usages;
}
