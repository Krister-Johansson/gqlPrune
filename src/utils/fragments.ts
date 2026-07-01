import { FragmentInfo } from '../types/FragmentInfo.js';
import { GraphqlFileEntities } from './operations.js';
import { isOperationUsedInContents } from './fileUtils.js';
import {
  buildFragmentPatterns,
  DEFAULT_FRAGMENT_USAGE_PATTERNS,
} from './usagePatterns.js';

/**
 * Computes the set of fragment names reachable from the given roots by walking
 * the fragment-spread graph. Cycle-safe.
 *
 * @param {Iterable<string>} roots - Fragment names that are known to be used.
 * @param {Map<string, string[]>} fragmentSpreads - Each fragment's direct spreads.
 * @returns {Set<string>} - All reachable fragment names (including the roots).
 */
export function reachableFragments(
  roots: Iterable<string>,
  fragmentSpreads: Map<string, string[]>,
): Set<string> {
  const reachable = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const name = stack.pop() as string;
    if (reachable.has(name)) {
      continue;
    }
    reachable.add(name);
    for (const dependency of fragmentSpreads.get(name) ?? []) {
      stack.push(dependency);
    }
  }
  return reachable;
}

/**
 * Returns the fragments that are not reachable from any root.
 *
 * @param {FragmentInfo[]} allFragments - Every fragment defined in the corpus.
 * @param {Iterable<string>} roots - Fragment names known to be used.
 * @param {Map<string, string[]>} fragmentSpreads - Each fragment's direct spreads.
 * @returns {FragmentInfo[]} - The unused (unreachable) fragments.
 */
export function findUnusedFragments(
  allFragments: FragmentInfo[],
  roots: Iterable<string>,
  fragmentSpreads: Map<string, string[]>,
): FragmentInfo[] {
  const reachable = reachableFragments(roots, fragmentSpreads);
  return allFragments.filter((fragment) => !reachable.has(fragment.name));
}

/**
 * Walks the parsed GraphQL corpus and returns fragments that are unused — i.e.
 * neither (a) reachable via fragment spreads from any operation, nor (b)
 * referenced in the application source (e.g. a `<Name>FragmentDoc` constant
 * under fragment masking). Operates on pre-parsed entities (see
 * `extractGraphqlEntities`) so each file is parsed once per scan; this function
 * never touches the filesystem. Schema-free.
 *
 * Note: a fragment is considered used as soon as any operation spreads it, even
 * if that operation is itself unused — that operation is reported separately, so
 * this avoids flagging a fragment that becomes orphaned only after the operation
 * is deleted (caught on the next run).
 *
 * @param {GraphqlFileEntities[]} parsedFiles - One parsed entry per gql file.
 * @param {string[]} fileContents - The already-read source file contents.
 * @param {string[]} fragmentUsagePatterns - Templates for source references.
 * @returns {FragmentInfo[]} - The unused fragments across the corpus.
 */
export function findUnusedFragmentsInCorpus(
  parsedFiles: GraphqlFileEntities[],
  fileContents: string[],
  fragmentUsagePatterns: string[] = DEFAULT_FRAGMENT_USAGE_PATTERNS,
): FragmentInfo[] {
  const allFragments: FragmentInfo[] = [];
  const fragmentSpreads = new Map<string, string[]>();
  const roots = new Set<string>();
  const seenFragmentNames = new Set<string>();

  for (const entities of parsedFiles) {
    entities.operationSpreads.forEach((spread) => roots.add(spread));
    for (const fragment of entities.fragments) {
      // Fragment names should be unique across the corpus. If they aren't, the
      // graph is keyed by name, so warn rather than silently conflate them.
      if (seenFragmentNames.has(fragment.name)) {
        console.warn(
          `Warning: duplicate fragment name "${fragment.name}" defined in multiple files; usage results may be approximate.`,
        );
      }
      seenFragmentNames.add(fragment.name);
      allFragments.push(fragment);
    }
    for (const { name, spreads } of entities.fragmentSpreads) {
      // Merge (not overwrite) so a duplicate definition cannot drop spread
      // edges — over-approximating reachability keeps results conservative.
      const existing = fragmentSpreads.get(name) ?? [];
      fragmentSpreads.set(name, [...new Set([...existing, ...spreads])]);
    }
  }

  // (b) A fragment referenced directly in source (fragment masking) is a root.
  for (const fragment of allFragments) {
    const patterns = buildFragmentPatterns(
      fragment.name,
      fragmentUsagePatterns,
    );
    if (isOperationUsedInContents(patterns, fileContents)) {
      roots.add(fragment.name);
    }
  }

  return findUnusedFragments(allFragments, roots, fragmentSpreads);
}
