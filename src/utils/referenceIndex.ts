// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import type { ModuleResolver } from './moduleResolver.js';
import type { Reference, SourceModule } from './sourceModule.js';

/**
 * The cross-file half of the usage engine. Every reference a module recorded
 * is resolved to a *canonical* binding: the declaration it reaches through
 * imports, re-exports, barrels and renames, or the last known name when the
 * chain leaves the scanned files. Usage verdicts, fragment roots, generated
 * file detection and confidence grading all read this index; none of them
 * ever look at source text again.
 */

/** One hop of a resolution chain, for `--verbose`. */
export interface ResolutionStep {
  /** The file the hop was taken in. */
  file: string;
  /** The name as known in that file. */
  name: string;
  /** The specifier followed, for an import or re-export hop. */
  specifier?: string;
  /** Why a chain stopped short, when it did. */
  note?: 'outside' | 'missing' | 'cycle';
}

export interface Canonical {
  /** The name usage patterns are matched against. */
  name: string;
  /**
   * The resolved path of the declaring file, `outside` when the chain left
   * the corpus (a package, an excluded file, a specifier nothing resolves),
   * or `unbound` for a bare identifier no import or declaration binds.
   */
  origin: string | 'outside' | 'unbound';
  /** True for a namespace binding (`import * as ns`, `export * as ns from`). */
  namespace?: boolean;
  steps: ResolutionStep[];
}

export type ResolvedReference = Reference & {
  /** The file as the scan discovered it. */
  file: string;
  /** Its resolved posix path. */
  path: string;
  canonical: Canonical;
};

export interface ReferenceIndex {
  /** Canonical name to every reference that resolves to it, in scan order. */
  byName: Map<string, ResolvedReference[]>;
  /** Resolved path to the references made from that file. */
  byFile: Map<string, ResolvedReference[]>;
  /** Resolved path to every declared or referenced name in that file. */
  identifiersByFile: Map<string, Set<string>>;
  /** Resolved path to the words inside that file's strings. */
  stringWordsByFile: Map<string, Set<string>>;
  /** Resolved paths in scan order. */
  files: string[];
  /** The discovered file name behind a resolved path. */
  displayName(path: string): string;
  /** The first reference, in scan order, to any of the names. */
  firstReference(names: readonly string[]): ResolvedReference | undefined;
  /** References that resolve to exactly this declaration: binding identity, not a name match. */
  referencesTo(origin: string, name: string): ResolvedReference[];
}

const OUTSIDE = 'outside';
const UNBOUND = 'unbound';

/**
 * Resolves names across a set of modules, memoising every binding and every
 * export it settles, so a name referenced a thousand times costs one lookup.
 */
class Resolver {
  private readonly locals = new Map<string, Canonical>();
  private readonly exportsMemo = new Map<string, Canonical | undefined>();
  private readonly targets = new Map<string, string | undefined>();

  constructor(
    private readonly modules: Map<string, SourceModule>,
    private readonly resolver: ModuleResolver,
  ) {}

  /** What a local name in a file stands for. */
  local(path: string, local: string): Canonical {
    const key = `${path}\0${local}`;
    const memo = this.locals.get(key);
    if (memo !== undefined) return memo;
    const result = this.resolveLocal(path, local);
    this.locals.set(key, result);
    return result;
  }

  private resolveLocal(path: string, local: string): Canonical {
    const module = this.modules.get(path);
    const binding = module?.imports.get(local);
    if (module === undefined || binding === undefined) {
      const origin = module?.declarations.has(local) ? path : UNBOUND;
      return { name: local, origin, steps: [] };
    }
    const step: ResolutionStep = {
      file: path,
      name: local,
      specifier: binding.specifier,
    };
    const target = this.target(path, binding.specifier);
    if (target === undefined) {
      const name =
        binding.kind === 'named' ? (binding.imported ?? local) : local;
      return outside(
        name,
        [{ ...step, note: OUTSIDE }],
        binding.kind === 'namespace',
      );
    }
    if (binding.kind === 'namespace') {
      return { name: local, origin: target, namespace: true, steps: [step] };
    }
    const exported =
      binding.kind === 'default' ? 'default' : (binding.imported ?? local);
    return prepend(
      step,
      this.export(target, exported, local) ??
        outside(missingName(exported, local), [
          { file: target, name: exported, note: 'missing' },
        ]),
    );
  }

  /** What an exported name of a file stands for, or undefined when it has no such export. */
  export(
    path: string,
    exported: string,
    fallback: string,
    active: Set<string> = new Set(),
  ): Canonical | undefined {
    const key = `${path}\0${exported}`;
    if (this.exportsMemo.has(key)) return this.exportsMemo.get(key);
    if (active.has(key)) return undefined;
    active.add(key);
    const result = this.resolveExport(path, exported, fallback, active);
    active.delete(key);
    this.exportsMemo.set(key, result);
    return result;
  }

  private resolveExport(
    path: string,
    exported: string,
    fallback: string,
    active: Set<string>,
  ): Canonical | undefined {
    const module = this.modules.get(path);
    if (module === undefined) return undefined;
    const entry = module.exports.get(exported);
    if (entry === undefined) {
      return this.starExport(module, exported, fallback, active);
    }
    if (entry.kind === 'local') {
      if (entry.local === undefined)
        return { name: fallback, origin: path, steps: [] };
      if (module.imports.has(entry.local)) return this.local(path, entry.local);
      return { name: entry.local, origin: path, steps: [] };
    }
    const step: ResolutionStep = {
      file: path,
      name: exported,
      specifier: entry.specifier,
    };
    const target = this.target(path, entry.specifier);
    if (entry.kind === 'namespace') {
      return target === undefined
        ? outside(exported, [{ ...step, note: OUTSIDE }], true)
        : { name: exported, origin: target, namespace: true, steps: [step] };
    }
    if (target === undefined) {
      return outside(missingName(entry.imported, exported), [
        { ...step, note: OUTSIDE },
      ]);
    }
    return prepend(
      step,
      this.export(target, entry.imported, exported, active) ??
        outside(missingName(entry.imported, exported), [
          { file: target, name: entry.imported, note: 'missing' },
        ]),
    );
  }

  /** The first `export * from` that provides the name; outside when one of them leaves the corpus. */
  private starExport(
    module: SourceModule,
    exported: string,
    fallback: string,
    active: Set<string>,
  ): Canonical | undefined {
    let escaped: ResolutionStep | undefined;
    for (const specifier of module.starExports) {
      const step: ResolutionStep = {
        file: module.path,
        name: exported,
        specifier,
      };
      const target = this.target(module.path, specifier);
      if (target === undefined) {
        escaped ??= { ...step, note: OUTSIDE };
        continue;
      }
      const found = this.export(target, exported, fallback, active);
      if (found !== undefined) return prepend(step, found);
    }
    return escaped === undefined ? undefined : outside(exported, [escaped]);
  }

  private target(path: string, specifier: string): string | undefined {
    const key = `${path}\0${specifier}`;
    if (this.targets.has(key)) return this.targets.get(key);
    const target = this.resolver.resolve(specifier, path);
    this.targets.set(key, this.modules.has(target ?? '') ? target : undefined);
    return this.targets.get(key);
  }
}

function outside(
  name: string,
  steps: ResolutionStep[],
  namespace = false,
): Canonical {
  const canonical: Canonical = { name, origin: OUTSIDE, steps };
  if (namespace) canonical.namespace = true;
  return canonical;
}

function prepend(step: ResolutionStep, canonical: Canonical): Canonical {
  return { ...canonical, steps: [step, ...canonical.steps] };
}

/** A default export that cannot be followed is known only by the importer's name for it. */
function missingName(exported: string, fallback: string): string {
  return exported === 'default' ? fallback : exported;
}

/**
 * Resolves every reference of every module and indexes the results.
 *
 * With the inline pass on, the words inside inline document bodies are left
 * out of `stringWordsByFile`: those bodies are definitions the scan already
 * knows, not mentions. With it off they count like any other string, as
 * they always have.
 */
export function buildReferenceIndex(
  modules: SourceModule[],
  moduleResolver: ModuleResolver,
  options: { inline?: boolean } = {},
): ReferenceIndex {
  const byPath = new Map(modules.map((module) => [module.path, module]));
  const resolver = new Resolver(byPath, moduleResolver);
  const byName = new Map<string, ResolvedReference[]>();
  const byFile = new Map<string, ResolvedReference[]>();
  const identifiersByFile = new Map<string, Set<string>>();
  const stringWordsByFile = new Map<string, Set<string>>();
  const byOrigin = new Map<string, ResolvedReference[]>();
  const displayNames = new Map<string, string>();

  for (const module of modules) {
    displayNames.set(module.path, module.file);
    identifiersByFile.set(module.path, module.identifiers);
    stringWordsByFile.set(
      module.path,
      options.inline
        ? module.stringWords
        : new Set([...module.stringWords, ...module.siteWords]),
    );
    const fromFile: ResolvedReference[] = [];
    for (const reference of module.references) {
      const canonical = canonicalOf(resolver, module.path, reference);
      if (canonical.namespace) continue;
      const resolved: ResolvedReference = {
        ...reference,
        file: module.file,
        path: module.path,
        canonical,
      };
      fromFile.push(resolved);
      push(byName, canonical.name, resolved);
      if (canonical.origin !== OUTSIDE && canonical.origin !== UNBOUND) {
        push(byOrigin, `${canonical.origin}\0${canonical.name}`, resolved);
      }
    }
    byFile.set(module.path, fromFile);
  }

  return {
    byName,
    byFile,
    identifiersByFile,
    stringWordsByFile,
    files: modules.map((module) => module.path),
    displayName: (path) => displayNames.get(path) ?? path,
    firstReference(names) {
      let first: ResolvedReference | undefined;
      for (const name of names) {
        for (const candidate of byName.get(name) ?? []) {
          if (first === undefined || precedes(candidate, first, modules))
            first = candidate;
          break;
        }
      }
      return first;
    },
    referencesTo: (origin, name) => byOrigin.get(`${origin}\0${name}`) ?? [],
  };
}

function canonicalOf(
  resolver: Resolver,
  path: string,
  reference: Reference,
): Canonical {
  if (reference.kind !== 'member') return resolver.local(path, reference.name);
  if (reference.base === undefined)
    return { name: reference.name, origin: UNBOUND, steps: [] };
  const base = resolver.local(path, reference.base);
  if (!base.namespace)
    return { name: reference.name, origin: UNBOUND, steps: [] };
  if (base.origin === OUTSIDE) {
    return outside(reference.name, [...base.steps]);
  }
  const step: ResolutionStep = {
    file: path,
    name: `${reference.base}.${reference.name}`,
  };
  return prepend(
    step,
    resolver.export(base.origin, reference.name, reference.name) ??
      outside(reference.name, [
        { file: base.origin, name: reference.name, note: 'missing' },
      ]),
  );
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** Scan order: file order first, then position. */
function precedes(
  a: ResolvedReference,
  b: ResolvedReference,
  modules: SourceModule[],
): boolean {
  if (a.path !== b.path) {
    return (
      modules.findIndex((m) => m.path === a.path) <
      modules.findIndex((m) => m.path === b.path)
    );
  }
  return a.line !== b.line ? a.line < b.line : a.column < b.column;
}

/**
 * The resolution chain behind a reference as lines for `--verbose`, one per
 * hop; empty for a bare identifier or a same-file declaration.
 */
export function describeResolution(canonical: Canonical): string[] {
  return canonical.steps.map((step, index) => {
    const verb =
      index === 0 && step.specifier !== undefined ? 'imported' : 're-exported';
    if (step.note === 'cycle') return `re-export cycle at ${step.file}`;
    if (step.note === 'missing')
      return `no export named ${step.name} in ${step.file}`;
    const base =
      step.specifier === undefined
        ? `member ${step.name} in ${step.file}`
        : `${verb} from '${step.specifier}' in ${step.file}`;
    return step.note === OUTSIDE
      ? `${base}, which is outside the scanned files`
      : base;
  });
}
