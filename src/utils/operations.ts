// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as fs from 'fs';
import * as path from 'path';
import { ASTNode, DocumentNode, parse, Source, visit } from 'graphql';
import { OperationInfo } from '../types/OperationInfo.js';
import { FragmentInfo } from '../types/FragmentInfo.js';

export type GraphqlFileEntities = {
  /** The file these entities were read from, as it was passed in. */
  filePath: string;
  /**
   * For an inline document (see `utils/inline.ts`), the constant it is assigned
   * to. Absent for a `.gql`/`.graphql` file and for an inline document that is
   * not assigned to anything.
   */
  identifier?: string;
  operations: OperationInfo[];
  fragments: FragmentInfo[];
  /** Names of fragments spread (directly or nested) by operations in the file. */
  operationSpreads: string[];
  /** Per-fragment direct fragment-spread dependencies. */
  fragmentSpreads: { name: string; spreads: string[] }[];
  /** Absolute paths of the documents this file pulls in via `#import`. */
  imports: string[];
  /** Whether the file defines an operation without a name. */
  hasAnonymousOperation: boolean;
  /**
   * The parsed document, tagged with the file path as its source name, or
   * `null` when the file failed to parse. Kept so later passes can walk the
   * selection sets without re-parsing, and so the opt-in schema checks can
   * validate the corpus and map findings back to the right file.
   */
  document: DocumentNode | null;
};

// A `#import "./other.gql"` line, as understood by graphql-tag's loader and the
// webpack graphql loaders. Anchored to the start of a line so a directive-looking
// string elsewhere in the document is not mistaken for one.
const IMPORT_LINE = /^[ \t]*#[ \t]*import[ \t]+(["'])(.+?)\1/gm;

/**
 * Returns the documents a file imports through `#import "..."` comment lines,
 * resolved against the importing file's directory so the same document has one
 * identity no matter how each importer spells the path. De-duplicated.
 *
 * @param {string} content - The raw file contents.
 * @param {string} filePath - The path of the importing file.
 * @returns {string[]} - Absolute paths of the imported documents.
 */
export function extractImports(content: string, filePath: string): string[] {
  const directory = path.dirname(filePath);
  const targets = new Set<string>();
  for (const match of content.matchAll(IMPORT_LINE)) {
    targets.add(path.resolve(directory, match[2]));
  }
  return [...targets];
}

/**
 * Returns the names of all fragment spreads (`...Name`) within a node, including
 * those nested in sub-selections and inline fragments. De-duplicated.
 *
 * @param {ASTNode} node - A parsed GraphQL AST node (operation or fragment).
 * @returns {string[]} - The fragment-spread names found within the node.
 */
export function getFragmentSpreads(node: ASTNode): string[] {
  const names = new Set<string>();
  visit(node, {
    FragmentSpread(spread) {
      names.add(spread.name.value);
    },
  });
  return [...names];
}

/**
 * Collects the definitions of an already-parsed document: its named operations,
 * its fragments, and the fragment-spread edges between them. Shared by the file
 * scan and the opt-in inline scan, so a document embedded in a `.tsx` file
 * yields exactly the same entities as one in a `.gql` file.
 *
 * @param {DocumentNode} document - The parsed document.
 * @param {string} filePath - The file the document came from.
 * @param {string[]} imports - Documents pulled in via `#import`; none inline.
 * @returns {GraphqlFileEntities} - Operations, fragments, spread edges, imports, document.
 */
export function buildGraphqlEntities(
  document: DocumentNode,
  filePath: string,
  imports: string[] = [],
): GraphqlFileEntities {
  const operations: OperationInfo[] = [];
  const fragments: FragmentInfo[] = [];
  const operationSpreads = new Set<string>();
  const fragmentSpreads: { name: string; spreads: string[] }[] = [];
  let hasAnonymousOperation = false;

  document.definitions.forEach((definition) => {
    if (definition.kind === 'OperationDefinition') {
      if (definition.name) {
        operations.push({
          name: definition.name.value,
          type: definition.operation,
          filePath,
          line: definition.loc?.startToken.line,
        });
      } else {
        hasAnonymousOperation = true;
      }
      // Spreads from every operation (named or anonymous) keep their
      // fragments alive, so they all count as reachability roots.
      getFragmentSpreads(definition).forEach((s) => operationSpreads.add(s));
    } else if (definition.kind === 'FragmentDefinition') {
      fragments.push({
        name: definition.name.value,
        filePath,
        line: definition.loc?.startToken.line,
      });
      fragmentSpreads.push({
        name: definition.name.value,
        spreads: getFragmentSpreads(definition),
      });
    }
  });

  return {
    filePath,
    operations,
    fragments,
    operationSpreads: [...operationSpreads],
    fragmentSpreads,
    imports,
    hasAnonymousOperation,
    document,
  };
}

/**
 * Parses a GraphQL file and extracts its named operations, fragment
 * definitions, the fragment-spread edges between them, and the documents it
 * pulls in via `#import`, plus the parsed document itself. Schema-free.
 *
 * @param {string} filePath - The path to the GraphQL file.
 * @returns {GraphqlFileEntities} - Operations, fragments, spread edges, imports, document.
 */
export function extractGraphqlEntities(filePath: string): GraphqlFileEntities {
  // Imports are read off the raw text before parsing, so a document that other
  // files import still protects them when it fails to parse itself.
  let imports: string[] = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    imports = extractImports(content, filePath);
    // Naming the Source after the file makes every node's location carry the
    // path, so a selection or a validation error can be reported against the
    // right file without extra bookkeeping.
    const ast = parse(new Source(content, filePath));
    return buildGraphqlEntities(ast, filePath, imports);
  } catch (error) {
    console.error(`Error parsing GraphQL file: ${filePath}`);
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    return {
      filePath,
      operations: [],
      fragments: [],
      operationSpreads: [],
      fragmentSpreads: [],
      imports,
      hasAnonymousOperation: false,
      document: null,
    };
  }
}
