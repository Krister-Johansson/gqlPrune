# Architecture

This page describes how gqlPrune is put together, for contributors and for
anyone deciding whether to trust it. For what the tool does and how to use it,
see the [README](../README.md).

## What it is

gqlPrune is a Node.js command-line tool, written in TypeScript and compiled to
`dist/` for publishing. It has one job: find GraphQL operations and fragments
that are defined in `.gql`/`.graphql` files but never referenced in a source
tree. It does this with static text analysis. It never executes the project it
scans, and it needs no schema and no running server.

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
    usagePatterns.ts      Default patterns and pattern expansion
    updateNotifier.ts     Once-a-day version check against the npm registry
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
4. **Detection.** For every operation, the usage patterns (by default the
   GraphQL Code Generator conventions) expand into concrete search strings, and
   the source files are searched for them as plain text. Fragments count as used
   when an operation spreads them, directly or through other fragments, or when
   a fragment pattern matches in source.
5. **Reporting.** Findings go to stdout as tables, or as a single JSON document
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

Six runtime dependencies, chosen to stay small: `graphql` (parsing),
`js-yaml` (config), `picomatch` (exclude globs), `kleur` (terminal color), and
`@inquirer/confirm` plus `@inquirer/input` (the two prompts `init` uses). The
update check uses Node's built-in `fetch` rather than a dependency.
