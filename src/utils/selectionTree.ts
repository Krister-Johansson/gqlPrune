// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  FragmentDefinitionNode,
  OperationDefinitionNode,
  SelectionSetNode,
} from 'graphql';
import { FieldLocation } from '../types/UnusedFieldInfo.js';
import { GraphqlFileEntities } from './operations.js';

// Clients and normalized caches add `__typename` themselves. Application code
// rarely names it, so flagging it would only ever be noise.
const IGNORED_RESPONSE_KEYS = new Set(['__typename']);

/**
 * One response key in an operation's result, the way the application sees
 * it: fragment spreads and inline fragments are already merged into their
 * parent, so `data.user.name` is one path whatever fragment selected `name`.
 */
export interface SelectionNode {
  /** The response key: the alias when the field is aliased. Empty for the root. */
  key: string;
  /** Response keys from the root down to this node. Empty for the root. */
  path: string[];
  /** Every place this key is selected, in first-seen order. */
  locations: FieldLocation[];
  /** The keys selected under this one, in first-seen order. */
  children: Map<string, SelectionNode>;
}

/** Fragment name to every definition of that name, with the file it sits in. */
export type FragmentDefinitions = Map<
  string,
  { definition: FragmentDefinitionNode; file: string }[]
>;

/**
 * Collects every fragment definition in a parsed corpus by name. A duplicated
 * name keeps all of its definitions, so a spread merges every one of them:
 * over-approximating the selection keeps a field verdict conservative, the
 * same choice the spread graph makes.
 *
 * @param {GraphqlFileEntities[]} parsedFiles - One parsed entry per document.
 * @returns {FragmentDefinitions} - Each fragment name's definitions.
 */
export function collectFragmentDefinitions(
  parsedFiles: GraphqlFileEntities[],
): FragmentDefinitions {
  const fragments: FragmentDefinitions = new Map();
  for (const { document } of parsedFiles) {
    if (document === null) continue;
    const file = document.loc?.source.name ?? '';
    for (const definition of document.definitions) {
      if (definition.kind !== 'FragmentDefinition') continue;
      const entries = fragments.get(definition.name.value) ?? [];
      entries.push({ definition, file });
      fragments.set(definition.name.value, entries);
    }
  }
  return fragments;
}

function createNode(key: string, path: string[]): SelectionNode {
  return { key, path, locations: [], children: new Map() };
}

/** Adds a location unless the same file and line is already recorded. */
function addLocation(node: SelectionNode, location: FieldLocation): void {
  const known = node.locations.some(
    (existing) =>
      existing.file === location.file && existing.line === location.line,
  );
  if (!known) node.locations.push(location);
}

function mergeSelections(
  selectionSet: SelectionSetNode,
  file: string,
  parent: SelectionNode,
  fragments: FragmentDefinitions,
  active: Set<string>,
): void {
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      const key = selection.alias?.value ?? selection.name.value;
      if (IGNORED_RESPONSE_KEYS.has(key)) continue;
      let node = parent.children.get(key);
      if (node === undefined) {
        node = createNode(key, [...parent.path, key]);
        parent.children.set(key, node);
      }
      addLocation(node, { file, line: selection.loc?.startToken.line });
      if (selection.selectionSet !== undefined) {
        mergeSelections(selection.selectionSet, file, node, fragments, active);
      }
    } else if (selection.kind === 'InlineFragment') {
      mergeSelections(selection.selectionSet, file, parent, fragments, active);
    } else {
      const name = selection.name.value;
      // A cycle is invalid GraphQL, but the scan must not loop on it.
      if (active.has(name)) continue;
      active.add(name);
      for (const entry of fragments.get(name) ?? []) {
        mergeSelections(
          entry.definition.selectionSet,
          entry.file,
          parent,
          fragments,
          active,
        );
      }
      active.delete(name);
    }
  }
}

/**
 * Builds the selection tree of one operation: every response key it selects,
 * with fragment spreads (followed through nested spreads, cycle-safe) and
 * inline fragments merged into the node that holds them. A key selected in
 * several places, directly or through fragments, is one node that keeps every
 * location. `__typename` is skipped.
 *
 * @param {OperationDefinitionNode} operation - The operation definition.
 * @param {string} file - The file the operation is defined in.
 * @param {FragmentDefinitions} fragments - The corpus's fragments by name.
 * @returns {SelectionNode} - The root node; its children are the top-level keys.
 */
export function buildSelectionTree(
  operation: OperationDefinitionNode,
  file: string,
  fragments: FragmentDefinitions,
): SelectionNode {
  const root = createNode('', []);
  mergeSelections(operation.selectionSet, file, root, fragments, new Set());
  return root;
}

/**
 * Every node under the root, depth first in selection order. The root itself
 * is not a field, so it is left out.
 *
 * @param {SelectionNode} root - The root of a selection tree.
 * @returns {SelectionNode[]} - Every field node.
 */
export function selectionNodes(root: SelectionNode): SelectionNode[] {
  const nodes: SelectionNode[] = [];
  const visit = (node: SelectionNode): void => {
    for (const child of node.children.values()) {
      nodes.push(child);
      visit(child);
    }
  };
  visit(root);
  return nodes;
}
