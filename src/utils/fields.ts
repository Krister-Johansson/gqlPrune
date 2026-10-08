// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { FragmentInfo } from '../types/FragmentInfo.js';
import { OperationInfo } from '../types/OperationInfo.js';
import { UnusedFieldInfo } from '../types/UnusedFieldInfo.js';
import { SourceFile } from './fileUtils.js';
import { GraphqlFileEntities } from './operations.js';
import type { ReferenceIndex, ResolvedReference } from './referenceIndex.js';
import {
  CallSite,
  createFieldReads,
  createTraceEnvironment,
  findCallSite,
  TraceEnvironment,
  traceCallSite,
  unreadSelections,
} from './resultFlow.js';
import {
  buildSelectionTree,
  collectFragmentDefinitions,
  SelectionNode,
  selectionNodes,
} from './selectionTree.js';
import { modulePathOf } from './sourceModule.js';
import { wholeWordPattern } from './stringHelpers.js';
import { buildUsagePatterns } from './usagePatterns.js';

/** The name an operation without one is reported under. */
export const ANONYMOUS_OPERATION = '(anonymous)';

/** What the field check needs to find and trace call sites. */
export interface FieldTraceOptions {
  /** The resolved references of the scanned sources. */
  index: ReferenceIndex;
  /** The usage-pattern templates operations are matched by. */
  usagePatterns: string[];
  /** The file and text behind a resolved module path. */
  source: (path: string) => SourceFile | undefined;
}

/** A position in a source file, 1-based. */
export interface SourcePosition {
  file: string;
  line: number;
  column: number;
}

/**
 * Why an operation's fields were matched by name instead of traced.
 *
 * - `no-reference`: nothing in the source refers to its identifiers, so there
 *   is no call site to start from.
 * - `untraceable-reference`: a reference that is neither a call nor a call
 *   argument, or one in a file the parser cannot take. The data may be read
 *   behind it.
 * - `mutation`: a mutation's selection can exist only to update the
 *   normalized cache, which no trace of its result can see.
 */
export type FieldFallbackReason =
  'no-reference' | 'untraceable-reference' | 'mutation';

/** How one used operation's fields were judged, for `--verbose`. */
export interface OperationFieldTrace {
  operation: string;
  type: OperationInfo['type'];
  /** The file the operation is defined in. */
  file: string;
  mode: 'traced' | 'fallback';
  /** The call sites that were traced; empty for a fallback. */
  callSites: SourcePosition[];
  fallback?: FieldFallbackReason;
  /** For `untraceable-reference`, the first such reference. */
  reference?: SourcePosition;
}

/** The field candidates, and how each used operation was judged. */
export interface FieldAnalysis {
  candidates: UnusedFieldInfo[];
  traces: OperationFieldTrace[];
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
  const pattern = wholeWordPattern(key);
  return sources.some((source) => pattern.test(source.content));
}

/** A reference as a position, for reporting. */
function positionOf(reference: ResolvedReference): SourcePosition {
  return {
    file: reference.file,
    line: reference.line,
    column: reference.column,
  };
}

/**
 * Every reference that stands for the operation: one resolving to an
 * expanded usage pattern, or, for an inline document, one resolving to the
 * constant it is assigned to. Type positions read no data and are left out.
 */
function operationReferences(
  operation: OperationInfo,
  identifier: string | undefined,
  trace: FieldTraceOptions,
): ResolvedReference[] {
  const found = [
    ...buildUsagePatterns(operation, trace.usagePatterns).flatMap(
      (pattern) => trace.index.byName.get(pattern) ?? [],
    ),
    ...(identifier === undefined
      ? []
      : trace.index.referencesTo(modulePathOf(operation.filePath), identifier)),
  ];
  const seen = new Set<string>();
  return found.filter((reference) => {
    const key = `${reference.path}\0${reference.line}\0${reference.column}`;
    if (reference.kind === 'type' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type CallSitePlan =
  | { mode: 'traced'; sites: CallSite[]; references: ResolvedReference[] }
  | {
      mode: 'fallback';
      fallback: FieldFallbackReason;
      reference?: ResolvedReference;
    };

/** Finds every call site of an operation, or the reason it cannot be traced. */
function planCallSites(
  operation: OperationInfo,
  identifier: string | undefined,
  trace: FieldTraceOptions | undefined,
  env: TraceEnvironment | undefined,
): CallSitePlan {
  if (operation.type === 'mutation') {
    return { mode: 'fallback', fallback: 'mutation' };
  }
  if (trace === undefined || env === undefined) {
    return { mode: 'fallback', fallback: 'no-reference' };
  }
  const references = operationReferences(operation, identifier, trace);
  if (references.length === 0) {
    return { mode: 'fallback', fallback: 'no-reference' };
  }
  const sites: CallSite[] = [];
  for (const reference of references) {
    const sourceFile = env.sourceFile(reference.path);
    const site =
      sourceFile &&
      findCallSite(
        sourceFile,
        reference.path,
        reference.line,
        reference.column,
      );
    if (site === undefined) {
      return { mode: 'fallback', fallback: 'untraceable-reference', reference };
    }
    sites.push(site);
  }
  return { mode: 'traced', sites, references };
}

function toCandidate(
  operation: string,
  node: SelectionNode,
  traced: boolean,
): UnusedFieldInfo {
  return {
    operation,
    path: node.path.join('.'),
    field: node.key,
    locations: node.locations,
    traced,
  };
}

/**
 * Finds the fields used operations select without reading them: a shortlist
 * of over-fetching candidates. Opt-in via `--fields` / `checkFields`, and
 * advisory only.
 *
 * Each used operation gets a selection tree, fragment spreads merged in, and
 * one of two verdicts:
 *
 * - **Traced.** Every reference to the operation's identifiers is a call or
 *   a call argument, so every call site's result is followed through the
 *   code (see `resultFlow.ts`). A field no read path reaches, and that lies
 *   under no value the trace lost track of, is a candidate. Only the topmost
 *   unread field of a branch is reported.
 * - **Fallback.** Nothing calls the operation the trace could follow (no
 *   reference, a reference in a position that is not a call, a mutation), so
 *   each of its own keys is matched by name against the source text, as the
 *   check always did: a key that appears nowhere as a whole word is a
 *   candidate.
 *
 * Unused operations and fragments are reported whole, so their fields are
 * left out. The key is the alias when a field is aliased, because that is the
 * name the application sees, and `__typename` is always skipped.
 *
 * @param {GraphqlFileEntities[]} parsedFiles - One parsed entry per document.
 * @param {OperationInfo[]} unusedOperations - Operations already reported unused.
 * @param {FragmentInfo[]} unusedFragments - Fragments already reported unused.
 * @param {SourceFile[]} sources - The source text the fallback searches.
 * @param {FieldTraceOptions} [trace] - Index and files for tracing; without it every operation falls back.
 * @returns {FieldAnalysis} - The candidates, per operation and path, and how each operation was judged.
 */
export function findUnusedFieldCandidates(
  parsedFiles: GraphqlFileEntities[],
  unusedOperations: OperationInfo[],
  unusedFragments: FragmentInfo[],
  sources: SourceFile[],
  trace?: FieldTraceOptions,
): FieldAnalysis {
  const unusedOperationNames = new Set(unusedOperations.map((op) => op.name));
  const fragments = collectFragmentDefinitions(parsedFiles);
  for (const fragment of unusedFragments) fragments.delete(fragment.name);
  const env =
    trace === undefined
      ? undefined
      : createTraceEnvironment(trace.index, trace.source);
  const keyFound = new Map<string, boolean>();
  const isKeyInSources = (key: string): boolean => {
    if (!keyFound.has(key)) {
      keyFound.set(key, isResponseKeyInSources(key, sources));
    }
    return keyFound.get(key) as boolean;
  };

  const candidates: UnusedFieldInfo[] = [];
  const traces: OperationFieldTrace[] = [];
  for (const entities of parsedFiles) {
    const { document } = entities;
    if (document === null) continue; // the file failed to parse; already reported
    const file = document.loc?.source.name ?? '';
    for (const definition of document.definitions) {
      if (definition.kind !== 'OperationDefinition') continue;
      const name = definition.name?.value;
      // An anonymous operation has no name to search for and is never in the
      // unused set, so it counts as used, like it does for fragments.
      if (name !== undefined && unusedOperationNames.has(name)) continue;
      const operation: OperationInfo = {
        name: name ?? ANONYMOUS_OPERATION,
        type: definition.operation,
        filePath: entities.filePath,
      };
      const root = buildSelectionTree(definition, file, fragments);
      const plan: CallSitePlan =
        name === undefined
          ? { mode: 'fallback', fallback: 'no-reference' }
          : planCallSites(operation, entities.identifier, trace, env);

      if (plan.mode === 'traced') {
        const reads = createFieldReads();
        for (const site of plan.sites) {
          traceCallSite(site, root, env as TraceEnvironment, reads);
        }
        for (const node of unreadSelections(root, reads)) {
          candidates.push(toCandidate(operation.name, node, true));
        }
        traces.push({
          operation: operation.name,
          type: operation.type,
          file,
          mode: 'traced',
          callSites: plan.references.map(positionOf),
        });
        continue;
      }

      for (const node of selectionNodes(root)) {
        if (!isKeyInSources(node.key)) {
          candidates.push(toCandidate(operation.name, node, false));
        }
      }
      traces.push({
        operation: operation.name,
        type: operation.type,
        file,
        mode: 'fallback',
        fallback: plan.fallback,
        ...(plan.reference === undefined
          ? {}
          : { reference: positionOf(plan.reference) }),
        callSites: [],
      });
    }
  }
  return { candidates, traces };
}
