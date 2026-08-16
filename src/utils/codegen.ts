// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';
import { GqlPruneConfig } from '../types/GqlPruneConfig.js';

/**
 * The GraphQL Code Generator config filenames gqlPrune looks for, in order.
 * The first one that exists wins; `package.json` comes last and only counts
 * when it carries a `codegen` key.
 */
export const CODEGEN_FILENAMES = [
  'codegen.ts',
  'codegen.mts',
  'codegen.cts',
  'codegen.js',
  'codegen.mjs',
  'codegen.cjs',
  'codegen.yml',
  'codegen.yaml',
  'codegen.json',
  'package.json',
] as const;

/** The parts of a codegen config gqlPrune can make use of. */
export type CodegenParts = {
  /** `documents` globs, negations included, exactly as written. */
  documents: string[];
  /** `schema` entries: file paths, URLs, whatever was written. */
  schema: string[];
  /** The keys of `generates`: the files and folders codegen writes. */
  outputs: string[];
  /** Preset names found anywhere in the config. */
  presets: string[];
  /** Plugin names found anywhere in the config. */
  plugins: string[];
};

/** A codegen config that was read, with the file it came from. */
export type CodegenConfig = CodegenParts & { file: string };

/**
 * The outcome of looking for a codegen config. Not finding one is an ordinary
 * result, not an error: the caller decides whether the absence matters.
 */
export type CodegenLookup =
  | { found: true; config: CodegenConfig }
  | { found: false; file?: string; reason: string };

/** Settings derived from a codegen config, and the file they came from. */
export type CodegenDerivation = {
  file: string;
  values: Partial<GqlPruneConfig>;
};

/**
 * One entry of the plugin/preset naming table: what a codegen plugin calls the
 * code it generates, expressed as gqlPrune usage patterns.
 *
 * Only conventions that produce a distinctive identifier are listed. A plugin
 * whose generated name is the bare operation name (`typescript-document-nodes`,
 * the `graphql-request` SDK methods) is deliberately absent: a `{Name}` pattern
 * matches any identically named identifier, which would report far too much as
 * used.
 */
export type CodegenPatternMapping = {
  /** The name as written in the codegen config, without a package scope. */
  name: string;
  kind: 'plugin' | 'preset';
  /** Replaces the built-in operation patterns when this entry matches. */
  usagePatterns?: string[];
  /** Replaces the built-in fragment patterns when this entry matches. */
  fragmentUsagePatterns?: string[];
  /** Whether the plugin keeps its documents inside source files. */
  inline?: boolean;
};

/** Every client-side plugin names its fragment constant this way. */
const FRAGMENT_DOC_PATTERNS = ['{Name}FragmentDoc'];

/** Every listed plugin also emits the operation's document constant. */
const DOCUMENT_PATTERN = '{Name}Document';

/**
 * The naming conventions gqlPrune recognizes. Matching one replaces the
 * built-in `usagePatterns` rather than adding to them: every extra pattern is
 * another way for a dead operation to look used, and a silent all-clear is the
 * worst result this tool can produce.
 */
export const CODEGEN_PATTERN_MAPPINGS: readonly CodegenPatternMapping[] = [
  {
    name: 'typescript-react-apollo',
    kind: 'plugin',
    usagePatterns: [
      'use{Name}{Type}',
      'use{Name}Lazy{Type}',
      'use{Name}Suspense{Type}',
      DOCUMENT_PATTERN,
    ],
    fragmentUsagePatterns: FRAGMENT_DOC_PATTERNS,
  },
  {
    name: 'typescript-urql',
    kind: 'plugin',
    usagePatterns: ['use{Name}{Type}', DOCUMENT_PATTERN],
    fragmentUsagePatterns: FRAGMENT_DOC_PATTERNS,
  },
  {
    name: 'typescript-vue-apollo',
    kind: 'plugin',
    usagePatterns: ['use{Name}{Type}', 'use{Name}Lazy{Type}', DOCUMENT_PATTERN],
    fragmentUsagePatterns: FRAGMENT_DOC_PATTERNS,
  },
  {
    name: 'typescript-vue-urql',
    kind: 'plugin',
    usagePatterns: ['use{Name}{Type}', DOCUMENT_PATTERN],
    fragmentUsagePatterns: FRAGMENT_DOC_PATTERNS,
  },
  {
    name: 'typescript-react-query',
    kind: 'plugin',
    usagePatterns: [
      'use{Name}{Type}',
      'useInfinite{Name}{Type}',
      'useSuspense{Name}{Type}',
      'useSuspenseInfinite{Name}{Type}',
      DOCUMENT_PATTERN,
    ],
    fragmentUsagePatterns: FRAGMENT_DOC_PATTERNS,
  },
  {
    name: 'typescript-solid-query',
    kind: 'plugin',
    usagePatterns: [
      'create{Name}{Type}',
      'createInfinite{Name}{Type}',
      'createSuspense{Name}{Type}',
      'createSuspenseInfinite{Name}{Type}',
      DOCUMENT_PATTERN,
    ],
    fragmentUsagePatterns: FRAGMENT_DOC_PATTERNS,
  },
  {
    name: 'typescript-apollo-angular',
    kind: 'plugin',
    usagePatterns: ['{Name}GQL', DOCUMENT_PATTERN],
    fragmentUsagePatterns: FRAGMENT_DOC_PATTERNS,
  },
  {
    name: 'typed-document-node',
    kind: 'plugin',
    usagePatterns: [DOCUMENT_PATTERN],
    fragmentUsagePatterns: FRAGMENT_DOC_PATTERNS,
  },
  {
    // The client preset hands the caller a constant: `const q = graphql(...)`
    // followed by `useQuery(q)` never names the operation, so no pattern can
    // find it. The inline scan follows the constant instead.
    name: 'client',
    kind: 'preset',
    inline: true,
  },
];

/** Document extensions whose files the inline scan can read. */
const INLINE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx'];

/** Extensions of a schema file gqlPrune can build a schema from. */
const SDL_EXTENSIONS = ['.graphql', '.gql', '.graphqls'];

// ---------------------------------------------------------------------------
// Reading a config
// ---------------------------------------------------------------------------

function emptyParts(): CodegenParts {
  return {
    documents: [],
    schema: [],
    outputs: [],
    presets: [],
    plugins: [],
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Flattens a config value into the strings it names: a plain string, the
 * strings and object keys of a list, or the keys of a map. That single shape
 * covers `documents: 'x'`, `schema: [{ 'https://…': { headers } }]` and
 * `plugins: [{ 'typescript-react-apollo': { withHooks: true } }]` alike.
 */
function toStringList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      typeof item === 'string'
        ? [item]
        : isRecord(item)
          ? Object.keys(item)
          : [],
    );
  }
  if (isRecord(value)) return Object.keys(value);
  return [];
}

/**
 * Walks a parsed (YAML/JSON) config and collects the keys gqlPrune cares
 * about, at any depth: a per-output `documents` override contributes just like
 * the top-level one.
 */
function collectFromValue(value: unknown, parts: CodegenParts): void {
  if (Array.isArray(value)) {
    for (const item of value) collectFromValue(item, parts);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'documents') parts.documents.push(...toStringList(child));
    if (key === 'schema') parts.schema.push(...toStringList(child));
    if (key === 'generates') parts.outputs.push(...toStringList(child));
    if (key === 'preset') parts.presets.push(...toStringList(child));
    if (key === 'plugins') parts.plugins.push(...toStringList(child));
    collectFromValue(child, parts);
  }
}

// ---------------------------------------------------------------------------
// Reading a TypeScript/JavaScript config, textually
// ---------------------------------------------------------------------------

/** An object-literal key and the offset its value starts at. */
type ObjectEntry = { key: string; valueStart: number };

const IDENTIFIER_KEY = /[A-Za-z_$][\w$]*/y;

/** Skips whitespace and both comment forms, returning the next code offset. */
function skipTrivia(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const char = text[i];
    if (char === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i + 2);
      i = newline === -1 ? text.length : newline + 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (!/\s/.test(char)) return i;
    i += 1;
  }
  return i;
}

function isQuote(char: string | undefined): boolean {
  return char === "'" || char === '"' || char === '`';
}

/** Returns the offset just past the string or template literal at `index`. */
function skipLiteral(text: string, index: number): number {
  const quote = text[index];
  let i = index + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === quote) return i + 1;
    if (char === '\n' && quote !== '`') return i;
    i += 1;
  }
  return text.length;
}

/**
 * Reads the string literal at `index`. Returns `null` when there is none, when
 * it never closes, or when it interpolates: `` `${root}/src/**` `` has no value
 * that can be known without running the file, so it is simply not extracted.
 */
function readString(
  text: string,
  index: number,
): { value: string; end: number } | null {
  const quote = text[index];
  if (!isQuote(quote)) return null;
  let value = '';
  let i = index + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === '\\') {
      value += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (char === quote) return { value, end: i + 1 };
    if (char === '\n' && quote !== '`') return null;
    if (quote === '`' && char === '$' && text[i + 1] === '{') return null;
    value += char;
    i += 1;
  }
  return null;
}

/** Returns the offset just past the bracketed group opening at `index`. */
function skipBalanced(text: string, index: number): number {
  const open = text[index];
  const close = open === '{' ? '}' : open === '[' ? ']' : ')';
  let depth = 0;
  let i = index;
  while (i < text.length) {
    const char = text[i];
    if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      const next = skipTrivia(text, i);
      i = next > i ? next : i + 1;
      continue;
    }
    if (isQuote(char)) {
      i = skipLiteral(text, i);
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return text.length;
}

/**
 * Returns the offset just past a value, stopping at the comma or closing
 * bracket that ends it. Whatever the value is (a call, a ternary, a spread) it
 * is stepped over as a unit.
 */
function skipValue(text: string, index: number): number {
  let i = skipTrivia(text, index);
  while (i < text.length) {
    const char = text[i];
    if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      const next = skipTrivia(text, i);
      i = next > i ? next : i + 1;
      continue;
    }
    if (isQuote(char)) {
      i = skipLiteral(text, i);
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      const next = skipBalanced(text, i);
      i = next > i ? next : i + 1;
      continue;
    }
    if (char === ',' || char === '}' || char === ']' || char === ')') return i;
    i += 1;
  }
  return i;
}

/**
 * Reads the entries of the object literal opening at `index`. A computed key
 * (`[outDir]:`), a spread, or a method definition yields no entry: it is
 * stepped over, and the value it holds stays unknown.
 */
function readObjectEntries(text: string, index: number): ObjectEntry[] {
  const entries: ObjectEntry[] = [];
  let i = skipTrivia(text, index + 1);
  while (i < text.length && text[i] !== '}') {
    const start = i;
    const literal = readString(text, i);
    let key: string | undefined;
    let cursor = i;
    if (literal !== null) {
      key = literal.value;
      cursor = literal.end;
    } else {
      IDENTIFIER_KEY.lastIndex = i;
      const match = IDENTIFIER_KEY.exec(text);
      if (match !== null) {
        key = match[0];
        cursor = i + match[0].length;
      }
    }
    cursor = skipTrivia(text, cursor);
    if (key !== undefined && text[cursor] === ':') {
      const valueStart = skipTrivia(text, cursor + 1);
      entries.push({ key, valueStart });
      i = skipValue(text, valueStart);
    } else {
      i = skipValue(text, i);
    }
    i = skipTrivia(text, i);
    if (text[i] === ',') i = skipTrivia(text, i + 1);
    if (i <= start) break; // nothing consumed: stop rather than loop forever
  }
  return entries;
}

/** The offsets the elements of the array literal at `index` start at. */
function readArrayElements(text: string, index: number): number[] {
  const starts: number[] = [];
  let i = skipTrivia(text, index + 1);
  while (i < text.length && text[i] !== ']') {
    starts.push(i);
    const next = skipValue(text, i);
    if (next <= i) break;
    i = skipTrivia(text, next);
    if (text[i] === ',') i = skipTrivia(text, i + 1);
  }
  return starts;
}

/** The textual counterpart of {@link toStringList}. */
function readStringList(text: string, index: number): string[] {
  const i = skipTrivia(text, index);
  const literal = readString(text, i);
  if (literal !== null) return [literal.value];
  if (text[i] === '[') {
    return readArrayElements(text, i).flatMap((start) =>
      readStringList(text, start),
    );
  }
  if (text[i] === '{') {
    return readObjectEntries(text, i).map((entry) => entry.key);
  }
  return [];
}

/** Collects from the object literal at `index`, and from every value in it. */
function collectFromSource(
  text: string,
  index: number,
  parts: CodegenParts,
): void {
  for (const { key, valueStart } of readObjectEntries(text, index)) {
    if (key === 'documents') {
      parts.documents.push(...readStringList(text, valueStart));
    }
    if (key === 'schema')
      parts.schema.push(...readStringList(text, valueStart));
    if (key === 'generates') {
      parts.outputs.push(...readStringList(text, valueStart));
    }
    if (key === 'preset')
      parts.presets.push(...readStringList(text, valueStart));
    if (key === 'plugins')
      parts.plugins.push(...readStringList(text, valueStart));
    const child = skipTrivia(text, valueStart);
    if (text[child] === '{') collectFromSource(text, child, parts);
    if (text[child] === '[') {
      for (const start of readArrayElements(text, child)) {
        const element = skipTrivia(text, start);
        if (text[element] === '{') collectFromSource(text, element, parts);
      }
    }
  }
}

/**
 * Reads a `codegen.ts` (or `.js`, `.mts`, …) textually, without executing it.
 *
 * Executing a project's config would mean running arbitrary code, and taking a
 * TypeScript or bundler dependency, to produce values that are only ever used
 * as defaults. So the file is scanned instead: string literals for `schema` and
 * `documents`, the keys of `generates`, and the plugin and preset names. A
 * value that is computed, imported, spread or interpolated cannot be known this
 * way and is skipped, which costs a suggestion and nothing more.
 *
 * The scan is comment- and string-aware, so a key written inside a comment or a
 * quoted string is not read as configuration. It does not parse JavaScript: as
 * in the inline scanner, a regular-expression literal holding a quote can throw
 * it off.
 *
 * @param {string} text - The config file's text.
 * @returns {CodegenParts} - Everything that could be extracted.
 */
export function extractCodegenFromSource(text: string): CodegenParts {
  const parts = emptyParts();
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      const next = skipTrivia(text, i);
      i = next > i ? next : i + 1;
      continue;
    }
    if (isQuote(char)) {
      i = skipLiteral(text, i);
      continue;
    }
    if (char === '{') {
      collectFromSource(text, i, parts);
      const next = skipBalanced(text, i);
      i = next > i ? next : i + 1;
      continue;
    }
    i += 1;
  }
  return parts;
}

/** Parses one config file's text according to its extension. */
function parseCodegenText(file: string, raw: string): CodegenParts | null {
  if (raw.trim() === '') return null;
  const parts = emptyParts();
  const extension = path.extname(file).toLowerCase();
  if (path.basename(file) === 'package.json') {
    const pkg: unknown = JSON.parse(raw);
    const codegen = isRecord(pkg) ? pkg.codegen : undefined;
    if (codegen === undefined) return null;
    collectFromValue(codegen, parts);
    return parts;
  }
  if (extension === '.json') {
    collectFromValue(JSON.parse(raw), parts);
    return parts;
  }
  if (extension === '.yml' || extension === '.yaml') {
    collectFromValue(yaml.load(raw), parts);
    return parts;
  }
  return extractCodegenFromSource(raw);
}

/**
 * Reads one codegen config file. Every failure comes back as a `found: false`
 * result naming the reason, so a caller that only wanted defaults can carry on
 * and a caller that asked for this file by name can report it.
 *
 * @param {string} file - Path to the config file.
 * @returns {CodegenLookup} - The normalized config, or why there is none.
 */
export function loadCodegenConfig(file: string): CodegenLookup {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { found: false, file, reason: `Could not read ${file}.` };
  }
  let parts: CodegenParts | null;
  try {
    parts = parseCodegenText(file, raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { found: false, file, reason: `Could not parse ${file}: ${detail}` };
  }
  if (parts === null) {
    return {
      found: false,
      file,
      reason: `No GraphQL Code Generator configuration in ${file}.`,
    };
  }
  return {
    found: true,
    config: {
      file,
      documents: unique(parts.documents),
      schema: unique(parts.schema),
      outputs: unique(parts.outputs),
      presets: unique(parts.presets),
      plugins: unique(parts.plugins),
    },
  };
}

/**
 * Looks for a codegen config in the working directory, trying
 * {@link CODEGEN_FILENAMES} in order. Only the current directory is searched:
 * gqlPrune's own config and its directory settings are relative to it too.
 *
 * @returns {CodegenLookup} - The first config that reads, or why there is none.
 */
export function discoverCodegenConfig(): CodegenLookup {
  for (const file of CODEGEN_FILENAMES) {
    if (!fs.existsSync(file)) continue;
    const lookup = loadCodegenConfig(file);
    if (lookup.found) return lookup;
  }
  return {
    found: false,
    reason: 'No GraphQL Code Generator config found in this directory.',
  };
}

// ---------------------------------------------------------------------------
// Deriving gqlPrune settings
// ---------------------------------------------------------------------------

/**
 * Turns a documents glob into the directory to scan. The file-name part is
 * dropped, and so is a trailing `**`: gqlPrune walks a directory recursively
 * and picks files by extension itself, so `src/**` and `src` mean the same
 * thing to it. A wildcard further up, as in a monorepo's `packages` glob, is
 * kept: `graphqlDir` and `srcDir` expand glob patterns of their own.
 *
 * @param {string} pattern - A codegen documents glob.
 * @returns {string} - The directory part, or `.` when nothing is left.
 */
export function globToDirectory(pattern: string): string {
  const segments = pattern.replace(/\\/g, '/').split('/');
  const last = segments[segments.length - 1];
  if (last.includes('.') || last === '*' || last === '**') segments.pop();
  while (segments[segments.length - 1] === '**') segments.pop();
  const dir = segments.join('/');
  return dir === '' ? '.' : dir;
}

/** The extensions a glob names, e.g. `ts` and `tsx` for `*.{ts,tsx}`. */
function globExtensions(pattern: string): string[] {
  const last = pattern.split('/').pop() ?? '';
  const braced = /\.\{([^{}]+)\}$/.exec(last);
  if (braced !== null) {
    return braced[1]
      .split(',')
      .map((extension) => extension.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean);
  }
  const simple = /\.([A-Za-z0-9]+)$/.exec(last);
  return simple === null ? [] : [simple[1].toLowerCase()];
}

/** Normalizes a path into an exclude pattern: root-relative, no trailing slash. */
function toExcludePattern(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Whether a `schema` entry names a local SDL file gqlPrune could read. A URL, an
 * interpolated value, a glob covering several files, and a `.json` or `.ts`
 * schema are all left alone: `schemaFile` takes one readable SDL document.
 */
function isLocalSdlPath(entry: string): boolean {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(entry)) return false;
  if (entry.includes('${')) return false;
  if (/[*?[\]{}]/.test(entry)) return false;
  return SDL_EXTENSIONS.includes(path.extname(entry).toLowerCase());
}

/** Strips the package scope and the `-preset` suffix from a plugin name. */
function normalizePluginName(name: string): string {
  return name
    .trim()
    .replace(/^@graphql-codegen\//, '')
    .replace(/-preset$/, '');
}

/**
 * Derives gqlPrune settings from a codegen config. Everything here is a
 * default: the user's own config and CLI flags win over all of it, so a value
 * that could not be worked out simply means one fewer suggestion.
 *
 * - `documents` globs become the directories to scan. Both `graphqlDir` and
 *   `srcDir` get them: the globs say where the project keeps its documents, and
 *   gqlPrune picks the `.gql`/`.graphql` and the `.ts`/`.tsx`/`.js`/`.jsx`
 *   files out of those directories itself.
 * - A negated glob (`!src/gql/**`) and every `generates` output become
 *   `exclude` entries. Excluding the generated files is what keeps them from
 *   referencing every operation and masking the whole result.
 * - Documents that live in source files turn the inline scan on.
 * - A local SDL `schema` becomes `schemaFile`.
 * - A recognized plugin or preset replaces the built-in usage patterns.
 *
 * @param {CodegenConfig} codegen - A config read by {@link loadCodegenConfig}.
 * @returns {Partial<GqlPruneConfig>} - Only the settings that could be derived.
 */
export function deriveGqlPruneConfig(
  codegen: CodegenConfig,
): Partial<GqlPruneConfig> {
  const documents = codegen.documents
    .map((glob) => glob.trim())
    .filter(Boolean);
  const included = documents.filter((glob) => !glob.startsWith('!'));
  const negated = documents
    .filter((glob) => glob.startsWith('!'))
    .map((glob) => glob.slice(1));

  const dirs = unique(included.map(globToDirectory));
  const exclude = unique(
    [...negated, ...codegen.outputs].map(toExcludePattern),
  );
  const schemaFile = codegen.schema
    .map((entry) => entry.trim())
    .find(isLocalSdlPath);

  const names = new Set(
    [...codegen.presets, ...codegen.plugins].map(normalizePluginName),
  );
  const matched = CODEGEN_PATTERN_MAPPINGS.filter((mapping) =>
    names.has(mapping.name),
  );
  const usagePatterns = unique(
    matched.flatMap((mapping) => mapping.usagePatterns ?? []),
  );
  const fragmentUsagePatterns = unique(
    matched.flatMap((mapping) => mapping.fragmentUsagePatterns ?? []),
  );
  const inline =
    included.some((glob) =>
      globExtensions(glob).some((extension) =>
        INLINE_EXTENSIONS.includes(extension),
      ),
    ) || matched.some((mapping) => mapping.inline === true);

  return {
    ...(dirs.length > 0 ? { graphqlDir: dirs, srcDir: dirs } : {}),
    ...(exclude.length > 0 ? { exclude } : {}),
    ...(schemaFile === undefined ? {} : { schemaFile }),
    ...(usagePatterns.length > 0 ? { usagePatterns } : {}),
    ...(fragmentUsagePatterns.length > 0 ? { fragmentUsagePatterns } : {}),
    ...(inline ? { inline: true } : {}),
  };
}

/** Renders one derived value for a report line. */
function formatValue(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/**
 * The human-readable line naming the codegen config a run took settings from,
 * and which settings those were. An inferred configuration has to be visible,
 * or a surprising result has no explanation.
 */
export function formatCodegenInfoLine(derivation: CodegenDerivation): string {
  const keys = Object.keys(derivation.values);
  return `Using settings derived from ${derivation.file}: ${keys.join(', ')}.`;
}

/** The `--verbose` lines listing every value a codegen config supplied. */
export function formatCodegenVerboseLines(
  derivation: CodegenDerivation,
): string[] {
  return [
    `codegen config: ${derivation.file}`,
    ...Object.entries(derivation.values).map(
      ([key, value]) => `codegen ${key}: ${formatValue(value)}`,
    ),
  ];
}
