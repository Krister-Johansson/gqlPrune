// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as path from 'path';
import { OperationInfo } from '../types/OperationInfo.js';
import { FragmentInfo } from '../types/FragmentInfo.js';
import { GraphqlFileEntities } from './operations.js';

/**
 * Keys a definition by kind, file and name, so same-named definitions stay
 * distinct. Operations and fragments are separate GraphQL namespaces, so a
 * `query Foo` and a `fragment Foo` in one file must not share a key.
 */
function definitionKey(
  kind: 'operation' | 'fragment',
  filePath: string,
  name: string,
): string {
  const prefix = kind === 'operation' ? 'op' : 'frag';
  return `${prefix}::${path.resolve(filePath)}::${name}`;
}

/** The only files a whole-file verdict applies to. */
const DOCUMENT_EXTENSIONS = ['.gql', '.graphql'];

/**
 * Returns the GraphQL files that are dead as a whole: every operation and
 * fragment they define is unused, and no other document pulls them in with an
 * `#import` comment. Operates on the already-parsed corpus and the unused sets
 * the scan produced, so it never touches the filesystem.
 *
 * Only `.gql`/`.graphql` files are eligible. A source file carrying an inline
 * document (see the opt-in `inline` scan) is never named here, however unused
 * its documents are: the file is a component or a module that happens to embed
 * GraphQL, so "delete the whole file" would be dangerous advice.
 *
 * Two cases are deliberately left out. A file that defines nothing (empty, or
 * one that failed to parse) is never flagged, because there is nothing to
 * judge. Neither is a file holding an anonymous operation: unnamed operations
 * are outside the usage tracking, so its contents cannot be shown unused.
 *
 * Like the rest of gqlPrune's findings these are candidates, not proof: a file
 * may still be read by another repository or by a tool this scan cannot see.
 *
 * @param {GraphqlFileEntities[]} parsedFiles - One parsed entry per gql file.
 * @param {OperationInfo[]} unusedOperations - The scan's unused operations.
 * @param {FragmentInfo[]} unusedFragments - The scan's unused fragments.
 * @returns {string[]} - The orphaned files, in scan order.
 */
export function findOrphanedFiles(
  parsedFiles: GraphqlFileEntities[],
  unusedOperations: OperationInfo[],
  unusedFragments: FragmentInfo[],
): string[] {
  const unused = new Set([
    ...unusedOperations.map((op) =>
      definitionKey('operation', op.filePath, op.name),
    ),
    ...unusedFragments.map((fragment) =>
      definitionKey('fragment', fragment.filePath, fragment.name),
    ),
  ]);

  // Import targets are already absolute; resolve the importee the same way so
  // './g/a.gql' and 'g/a.gql' compare equal. A file importing itself does not
  // count as an importer, or nothing self-referential could ever be orphaned.
  const imported = new Set<string>();
  for (const file of parsedFiles) {
    const self = path.resolve(file.filePath);
    for (const target of file.imports) {
      const resolved = path.resolve(target);
      if (resolved !== self) {
        imported.add(resolved);
      }
    }
  }

  return parsedFiles
    .filter((file) => {
      if (!DOCUMENT_EXTENSIONS.includes(path.extname(file.filePath))) {
        return false;
      }
      if (file.hasAnonymousOperation) return false;
      const definitions: { kind: 'operation' | 'fragment'; name: string }[] = [
        ...file.operations.map((op) => ({
          kind: 'operation' as const,
          name: op.name,
        })),
        ...file.fragments.map((fragment) => ({
          kind: 'fragment' as const,
          name: fragment.name,
        })),
      ];
      if (definitions.length === 0) return false;
      if (imported.has(path.resolve(file.filePath))) return false;
      return definitions.every((definition) =>
        unused.has(
          definitionKey(definition.kind, file.filePath, definition.name),
        ),
      );
    })
    .map((file) => file.filePath);
}
