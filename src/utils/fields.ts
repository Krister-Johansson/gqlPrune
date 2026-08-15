// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { ASTNode, FragmentDefinitionNode, visit } from 'graphql';
import { FragmentInfo } from '../types/FragmentInfo.js';
import { OperationInfo } from '../types/OperationInfo.js';
import { FieldLocation, UnusedFieldInfo } from '../types/UnusedFieldInfo.js';
import { SourceFile } from './fileUtils.js';
import { reachableFragments } from './fragments.js';
import { getFragmentSpreads, GraphqlFileEntities } from './operations.js';

// Clients and normalized caches add `__typename` themselves. Application code
// rarely names it, so flagging it would only ever be noise.
const IGNORED_RESPONSE_KEYS = new Set(['__typename']);

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
 * Whether a response key appears as a whole word in any scanned source file.
 * Case-sensitive and bounded by `\b`, so `id` matches `data.id` but not `video`.
 *
 * @param {string} key - The response key to look for.
 * @param {SourceFile[]} sources - The already-read source files.
 * @returns {boolean} - True when the key appears in at least one file.
 */
export function isResponseKeyInSources(
  key: string,
  sources: SourceFile[],
): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(key)}\\b`);
  return sources.some((source) => pattern.test(source.content));
}

/** Records every response key selected within a definition, with its location. */
function collectResponseKeys(
  definition: ASTNode,
  file: string,
  keys: Map<string, FieldLocation[]>,
): void {
  visit(definition, {
    Field(node) {
      const key = node.alias?.value ?? node.name.value;
      if (IGNORED_RESPONSE_KEYS.has(key)) {
        return;
      }
      const locations = keys.get(key) ?? [];
      locations.push({ file, line: node.loc?.startToken.line });
      keys.set(key, locations);
    },
  });
}

/**
 * Finds response keys that no scanned source file mentions: a shortlist of
 * fields the application may be fetching without ever reading. Opt-in via
 * `--fields` / `checkFields`, and advisory only.
 *
 * Scope is deliberately narrow. Only used operations, and the fragments they
 * reach through the spread graph, contribute keys: an unused operation or
 * fragment is already reported whole, so its fields would just be noise. The
 * key is the alias when a field is aliased, because that is the name the
 * application sees. `__typename` is always skipped.
 *
 * The verdict is a plain string search, so it inherits the same limits as the
 * rest of the tool and then some: a key destructured under a new name, spread
 * wholesale into props, or read by another repository still looks unread, while
 * a key with a common name (`id`, `name`) will match somewhere and can never be
 * flagged even when it is genuinely dead.
 *
 * @param {GraphqlFileEntities[]} parsedFiles - One parsed entry per gql file.
 * @param {OperationInfo[]} unusedOperations - Operations already reported unused.
 * @param {FragmentInfo[]} unusedFragments - Fragments already reported unused.
 * @param {SourceFile[]} sources - The already-read source files.
 * @returns {UnusedFieldInfo[]} - One finding per flagged key, in first-seen order.
 */
export function findUnusedFieldCandidates(
  parsedFiles: GraphqlFileEntities[],
  unusedOperations: OperationInfo[],
  unusedFragments: FragmentInfo[],
  sources: SourceFile[],
): UnusedFieldInfo[] {
  const unusedOperationNames = new Set(unusedOperations.map((op) => op.name));
  const unusedFragmentNames = new Set(
    unusedFragments.map((fragment) => fragment.name),
  );

  // Merge (not overwrite) duplicate names' edges, exactly as the fragment scan
  // does, so reachability stays conservative.
  const fragmentSpreads = new Map<string, string[]>();
  for (const entities of parsedFiles) {
    for (const { name, spreads } of entities.fragmentSpreads) {
      const existing = fragmentSpreads.get(name) ?? [];
      fragmentSpreads.set(name, [...new Set([...existing, ...spreads])]);
    }
  }

  const roots = new Set<string>();
  const keys = new Map<string, FieldLocation[]>();
  const fragmentDefinitions: {
    definition: FragmentDefinitionNode;
    file: string;
  }[] = [];

  for (const { document } of parsedFiles) {
    if (document === null) {
      continue; // the file failed to parse; it has already been reported
    }
    const file = document.loc?.source.name ?? '';
    for (const definition of document.definitions) {
      if (definition.kind === 'OperationDefinition') {
        // An anonymous operation has no name to search for and is never in the
        // unused set, so it counts as used, like it does for fragments.
        if (
          definition.name &&
          unusedOperationNames.has(definition.name.value)
        ) {
          continue;
        }
        getFragmentSpreads(definition).forEach((spread) => roots.add(spread));
        collectResponseKeys(definition, file, keys);
      } else if (definition.kind === 'FragmentDefinition') {
        // Held back until every used operation has contributed its roots.
        fragmentDefinitions.push({ definition, file });
      }
    }
  }

  const reachable = reachableFragments(roots, fragmentSpreads);
  for (const { definition, file } of fragmentDefinitions) {
    const name = definition.name.value;
    if (!reachable.has(name) || unusedFragmentNames.has(name)) {
      continue;
    }
    collectResponseKeys(definition, file, keys);
  }

  return [...keys]
    .filter(([key]) => !isResponseKeyInSources(key, sources))
    .map(([field, locations]) => ({ field, locations }));
}
