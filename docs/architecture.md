# Architecture

This page describes how gqlPrune is put together, for contributors and for
anyone deciding whether to trust it. For what the tool does and how to use it,
see the [README](../README.md).

## What it is

gqlPrune is a Node.js command-line tool, written in TypeScript and compiled to
`dist/` for publishing. It has one job: find GraphQL operations and fragments
that are defined in `.gql`/`.graphql` files but never referenced in a source
tree. It does this by parsing the source with the TypeScript compiler API and
resolving imports between the files it read. It never executes the project it
scans, never creates a type checker, and it needs no schema and no running
server.

## Layout

```text
src/
  cli.ts                  Entry point: parses argv, dispatches init | scan
  core/
    gqlPruner.ts          Orchestration plus the pure scan/report helpers
    configGenerator.ts    The interactive `gqlprune init` command
  utils/
    args.ts               Flag parsing (--json, --verbose, --exclude, ...)
    fileUtils.ts          Directory walking, file reading, exclusion matching
    operations.ts         Extracts operations from GraphQL documents
    fragments.ts          Cross-file fragment spread graph
    orphans.ts            Whole-file dead documents
    sourceModule.ts       One source file parsed into imports, exports, references
                          and inline document sites; a token fallback for the rest
    referenceIndex.ts     Every reference resolved through imports, re-exports and
                          barrels to a canonical name
    moduleResolver.ts     ts.resolveModuleName over the files the scan read
    tsconfig.ts           baseUrl and paths from the nearest tsconfig
    inline.ts             Inline gql/graphql documents (opt-in --inline)
    confidence.ts         Grades findings by the evidence in the index
    fields.ts             Field candidates (opt-in --fields), still a text search
    deprecated.ts         Deprecated selections against a local SDL (opt-in)
    codegen.ts            Reads a GraphQL Code Generator config for defaults
    jsLexer.ts            The comment/string lexer codegen.ts reads a config with
    completions.ts        Shell completion scripts
    usagePatterns.ts      Default patterns and pattern expansion
    stringHelpers.ts      Small string utilities
    pkgInfo.ts            Reads the package's own name and version
  types/                  Shared interfaces (GqlPruneConfig, OperationInfo, ...)
test/                     Jest specs, one per source module
```

## How a scan works

1. **Configuration.** `cli.ts` merges `gqlPrune.config.yaml` (parsed with
   js-yaml's safe loader) with command-line flags. Flags override the file.
   Bad input (unknown flag, missing directory, unreadable config) stops the run
   with exit code 2 before any scanning happens.
2. **Discovery.** `fileUtils` walks the configured directories, applying the
   gitignore-style `exclude` patterns. `node_modules` and `.git` are always
   skipped and cannot be re-included. The walker tracks real paths so symlink
   cycles terminate.
3. **Extraction.** Each `.gql`/`.graphql` file is parsed with the `graphql`
   package. Operations and fragments come out with their name, type, file, and
   line number.
4. **Parsing.** Each source file is parsed once with `ts.createSourceFile`
   into a module model: its import bindings, exports, every identifier in a
   reference position with its line and column, its inline `gql`/`graphql`
   document sites, and the words inside its strings. Declaration names, import
   and export specifiers, object keys, comments and string text are never
   references. A file the parser cannot take (a `.vue` named in
   `sourceExtensions`) is reduced to its identifier tokens instead.
5. **Resolution.** Every reference is resolved through named, default and
   namespace imports, `export { a as b } from`, `export *` and barrel files to
   a canonical name: the declaration it reaches, or the last known name when
   the chain leaves the scanned files or meets a specifier nothing resolves.
   Module resolution is the compiler's own, over an in-memory host that can
   only land on a file the scan read, with `baseUrl` and `paths` from the
   nearest tsconfig.
6. **Detection.** For every operation, the usage patterns (by default the
   GraphQL Code Generator conventions) expand into identifiers, and the
   operation is used when some reference resolves to one of them. Fragments
   count as used when an operation spreads them, directly or through other
   fragments, or when a reference resolves to a fragment pattern. Inline
   documents are used when the constant they are assigned to is referenced, by
   binding identity. The generated-file heuristic and the confidence grades
   read the same index; the opt-in field check is the one pass that still
   reads the files as text.
7. **Reporting.** Findings go to stdout as tables, or as a single JSON document
   with `--json`. Diagnostics, warnings, and GitHub Actions annotations go to
   stderr, so JSON output stays parseable. Exit code 0 means clean, 1 means
   findings, 2 means the run itself failed.

## Design rules

The codebase keeps its logic in small pure functions that are exported and
tested directly (pattern expansion, exclusion matching, detection, report
shaping). `mainFunction` in `gqlPruner.ts` only wires those functions to the
filesystem and the console. This split is what keeps the test suite fast and
the behavior easy to verify; new code is expected to follow it.

Two I/O rules matter throughout:

- In `--json` mode, stdout carries only the JSON document. Everything meant for
  humans goes to stderr.
- Reporting paths set `process.exitCode` instead of calling `process.exit()`,
  so buffered output flushes before the process ends.

## Dependencies

Eight runtime dependencies, chosen to stay small: `graphql` (parsing
documents), `typescript` (parsing source files; only `createSourceFile` and the
module resolver are used, never a program or a type checker), `js-yaml`
(config), `picomatch` (exclude globs), `kleur` (terminal color), and
`@inquirer/checkbox`, `@inquirer/confirm` and `@inquirer/input` (the prompts
`init` uses). gqlPrune makes no network requests.
