// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { DocumentNode, parse, Source } from 'graphql';
import { buildGraphqlEntities, GraphqlFileEntities } from './operations.js';
import type { ReferenceIndex } from './referenceIndex.js';
import { modulePathOf, SourceModule } from './sourceModule.js';

/** One inline GraphQL document that parsed successfully. */
export type InlineDocument = {
  /** The source file the document was found in. */
  filePath: string;
  /** The constant the document is assigned to, when the statement declares one. */
  identifier?: string;
  /**
   * Whether the surrounding code consumes the document where it is written, as
   * in `useQuery(gql`...`)`. Such a document is used by construction: the
   * statement that defines it is the statement that uses it. False for one
   * standing alone as its own statement, which nothing has to consume.
   */
  consumed: boolean;
  /** The parsed document, located against the source file's real lines. */
  document: DocumentNode;
};

/** What one source file contributed to the inline scan. */
export type InlineExtraction = {
  file: string;
  documents: InlineDocument[];
  /** Recognized bodies that failed to parse and were skipped. */
  skipped: number;
  /**
   * Offsets of every parsed document body, so a pass that still reads the
   * file as text (the field check) can blank the definitions out of it.
   */
  bodyRanges: { start: number; end: number }[];
};

/** An inline document kept alive by a reference to the constant it is assigned to. */
export type InlineIdentifierUsage = {
  identifier: string;
  /** The source file that references the constant. */
  file: string;
  /** Where in that file, when a reference was found (absent for a consumed document). */
  line?: number;
  column?: number;
  /** Names of the operations the document defines. */
  operations: string[];
  /** Names of the fragments the document defines. */
  fragments: string[];
};

/**
 * Parses the inline documents the module model found in one source file.
 *
 * The sites come from the syntax tree, so a tag inside a comment or a string
 * never becomes a document, and a document never sees its own text: its body
 * is a literal, which the reference walk records as words rather than as
 * identifiers, and the constant it is assigned to is a declaration, which is
 * never a reference. Those two facts are what used to take blanking the
 * defining statement out of a text corpus.
 *
 * A body that does not parse is counted and skipped: a half-written template is
 * a normal state for a file being edited and must never abort the scan.
 *
 * @param {SourceModule} module - The parsed source file.
 * @returns {InlineExtraction} - Parsed documents, skip count, body offsets.
 */
export function extractInlineDocuments(module: SourceModule): InlineExtraction {
  const documents: InlineDocument[] = [];
  const bodyRanges: { start: number; end: number }[] = [];
  let skipped = 0;

  for (const site of module.inlineSites) {
    // graphql-js does not apply a Source's locationOffset to token locations,
    // so the body is padded with the newlines and columns that precede it in
    // the file instead. Every reported line then points at the .ts file itself.
    const padded =
      '\n'.repeat(site.line - 1) + ' '.repeat(site.column - 1) + site.body;
    try {
      documents.push({
        filePath: module.file,
        ...(site.identifier === undefined
          ? {}
          : { identifier: site.identifier }),
        consumed: site.consumed,
        document: parse(new Source(padded, module.file)),
      });
      bodyRanges.push(site.textRange);
    } catch {
      skipped += 1;
    }
  }

  return { file: module.file, documents, skipped, bodyRanges };
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
    consumed: document.consumed,
  }));
}

/**
 * Finds the inline documents whose constant is referenced somewhere. This is
 * the signal that makes the client-preset convention work: `const q =
 * graphql(...)` followed by `useQuery(q)` names no operation anywhere, so no
 * usage pattern can ever match it.
 *
 * The lookup is by binding identity: a reference counts only when it resolves
 * to the declaration in the defining file, through whatever imports and
 * re-exports lead there. Two files using the same obvious name (`query`,
 * `doc`) is the norm under the client preset, and a name match would let one
 * file's use of its own document vouch for another file's dead one.
 *
 * @param {GraphqlFileEntities[]} inlineFiles - Entities of the inline documents.
 * @param {ReferenceIndex} index - The resolved references of the scanned sources.
 * @returns {InlineIdentifierUsage[]} - One entry per referenced document.
 */
export function findInlineIdentifierUsage(
  inlineFiles: GraphqlFileEntities[],
  index: ReferenceIndex,
): InlineIdentifierUsage[] {
  const usages: InlineIdentifierUsage[] = [];
  for (const entities of inlineFiles) {
    const names = {
      operations: entities.operations.map((operation) => operation.name),
      fragments: entities.fragments.map((fragment) => fragment.name),
    };
    const { identifier } = entities;

    // A document written straight into a call is used by the statement that
    // defines it. Nothing else can vouch for it: it has no name to refer to.
    if (identifier === undefined) {
      if (entities.consumed === true) {
        usages.push({
          identifier: 'its definition site',
          file: entities.filePath,
          ...names,
        });
      }
      continue;
    }

    const [reference] = index.referencesTo(
      modulePathOf(entities.filePath),
      identifier,
    );
    if (reference === undefined) continue;
    usages.push({
      identifier,
      file: reference.file,
      line: reference.line,
      column: reference.column,
      ...names,
    });
  }
  return usages;
}
