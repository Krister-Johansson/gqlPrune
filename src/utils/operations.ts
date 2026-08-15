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
   * The parsed document, so a later pass can walk the selection sets without
   * re-parsing the file. Node locations carry the file path (the document was
   * parsed from a named `Source`). `null` when the file failed to parse.
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
 * Parses a GraphQL file and extracts its named operations, fragment
 * definitions, the fragment-spread edges between them, and the documents it
 * pulls in via `#import`. Schema-free.
 *
 * @param {string} filePath - The path to the GraphQL file.
 * @returns {GraphqlFileEntities} - Operations, fragments, spread edges, imports.
 */
export function extractGraphqlEntities(filePath: string): GraphqlFileEntities {
  // Imports are read off the raw text before parsing, so a document that other
  // files import still protects them when it fails to parse itself.
  let imports: string[] = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    imports = extractImports(content, filePath);
    // Naming the Source puts the file path on every node's location, so later
    // passes can report where a selection lives without extra bookkeeping.
    const ast = parse(new Source(content, filePath));
    const operations: OperationInfo[] = [];
    const fragments: FragmentInfo[] = [];
    const operationSpreads = new Set<string>();
    const fragmentSpreads: { name: string; spreads: string[] }[] = [];
    let hasAnonymousOperation = false;

    ast.definitions.forEach((definition) => {
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
      document: ast,
    };
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
