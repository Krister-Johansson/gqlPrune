# gqlPrune: GraphQL unused operations checker

[![npm](https://img.shields.io/npm/v/gqlprune)](https://www.npmjs.com/package/gqlprune)
[![npm downloads](https://img.shields.io/npm/dm/gqlprune)](https://www.npmjs.com/package/gqlprune)
[![node](https://img.shields.io/node/v/gqlprune)](https://www.npmjs.com/package/gqlprune)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[![CI](https://github.com/Krister-Johansson/gqlPrune/actions/workflows/ci.yml/badge.svg)](https://github.com/Krister-Johansson/gqlPrune/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Krister-Johansson/gqlPrune/branch/main/graph/badge.svg)](https://codecov.io/gh/Krister-Johansson/gqlPrune)
[![Socket Badge](https://socket.dev/api/badge/npm/package/gqlprune)](https://socket.dev/npm/package/gqlprune)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Krister-Johansson/gqlPrune/badge)](https://scorecard.dev/viewer/?uri=github.com/Krister-Johansson/gqlPrune)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/13364/badge)](https://www.bestpractices.dev/projects/13364)
[![OpenSSF Baseline](https://www.bestpractices.dev/projects/13364/baseline)](https://www.bestpractices.dev/projects/13364)

`gqlPrune` finds unused GraphQL operations (queries, mutations, subscriptions) and unused fragments in your project. It scans `.gql`/`.graphql` files and checks whether each operation is referenced in your TypeScript/JavaScript source, and whether each fragment is spread by an operation or referenced in source. It does not need a running server or a schema.

## Migrating from 1.x to 2.0

- gqlPrune 2.x requires Node.js 20 or newer.
- The CLI command is `gqlprune` (lowercase), matching the package name. Both `npx gqlprune` and a global `gqlprune` work.
- Usage detection is broader and configurable. It now also matches lazy/suspense hooks and the generated `<Name>Document` constant, not just `use<Name><Type>`. If you use a different client (urql, react-query, raw documents, ...), set [`usagePatterns`](#configuration) so your operations aren't reported as unused.
- Folder exclusion works as documented: `excludedFolders` matches by folder name or root-relative path, and `node_modules` and `.git` are always excluded. (In 1.x the documented `node_modules` entry silently did nothing.)

## How it detects usage

An operation counts as used if any of the search strings derived from its name appears in your source files. By default `gqlPrune` looks for the conventions emitted by [GraphQL Code Generator](https://the-guild.dev/graphql/codegen) (the `typescript-react-apollo` / near-operation-file presets):

For an operation `query GetUser`, the defaults match:

| Pattern                   | Example                   |
| ------------------------- | ------------------------- |
| `use{Name}{Type}`         | `useGetUserQuery`         |
| `use{Name}Lazy{Type}`     | `useGetUserLazyQuery`     |
| `use{Name}Suspense{Type}` | `useGetUserSuspenseQuery` |
| `{Name}Document`          | `GetUserDocument`         |

If your project uses a different convention (urql, react-query, graphql-request, Vue, raw documents, etc.), override the patterns with `usagePatterns` in the config, described below. Without an override, operations may be wrongly reported as unused.

### Unused fragments

`gqlPrune` also reports fragments that are never used, across files and without a schema. A fragment counts as used when it is either:

- spread (directly or transitively) by any operation in your `.gql` corpus, or
- referenced in your source via a fragment pattern, by default the codegen `<Name>FragmentDoc` constant (for example under fragment masking). Override with `fragmentUsagePatterns`.

A fragment spread only by another unused fragment is reported too. Note that a fragment is kept alive by any operation that spreads it, even an unused one. That operation is reported separately, so the fragment surfaces on the next run once you remove the operation.

### Avoiding false "all clear" results

Because usage is detected by string-matching `srcDir`, GraphQL Code Generator output that lives inside `srcDir` is a trap: a single generated file (such as `src/gql/graphql.ts`) references every operation, so everything looks used and nothing is ever reported unused, with no error to tell you so.

gqlPrune guards against this. When one source file alone references most of your operations, it prints a warning naming the file and pointing you at `exclude`:

> ⚠ Suspected generated file "src/gql/graphql.ts" references 100% of all operations (50/50) and looks generated — add it to "exclude" in gqlPrune.config.yaml or unused results will be unreliable.

Add it to `exclude` (for example `'**/*.generated.ts'`) and re-run, or run `gqlprune init`, which detects such a file and pre-fills it into `exclude` for you. The warning goes to stderr (so it also surfaces in `--json` mode) and is included in the JSON report's `warnings` array; it does not change the exit code.

## Setup

### Installation

Requires Node.js 20 or newer.

```bash
npm install --save-dev gqlprune
```

### Configuration

Run the `init` command to generate `gqlPrune.config.yaml` at the root of your project. It auto-detects your GraphQL and source directories (scanning the project and skipping `node_modules`, `.git`, and `dist`) and offers them as defaults you can accept or override. It also detects a generated file that would mask your results (the [false "all clear"](#avoiding-false-all-clear-results) trap) and pre-fills it into `exclude`, so your first run is truthful. After writing the file it prints a preview of what a real run would find:

```bash
npx gqlprune init
```

```text
✓ Found 42 operations in 12 files; 5 look unused. Run "gqlprune" to see them.
```

If a `gqlPrune.config.yaml` already exists, `init` asks before overwriting it (defaulting to No), so an existing hand-tuned config is never clobbered by accident.

```yaml
graphqlDir: ./path/to/graphql
srcDir: ./src
# Files/folders to skip (gitignore-flavored globs). `init` pre-fills any
# generated file it detects (it would otherwise mask all results); add more.
exclude:
  - src/gql/graphql.ts
  - '**/__generated__'
# Optional — override how operation usage is detected.
# Supports {name}, {Name}, {type}, {Type} placeholders.
usagePatterns:
  - use{Name}{Type}
  - '{Name}Document'
# Optional — override how fragments are matched in source (e.g. masking).
# Supports {name}, {Name} placeholders.
fragmentUsagePatterns:
  - '{Name}FragmentDoc'
```

- `graphqlDir`: directory, or an array of directories, containing your `.gql`/`.graphql` files.
- `srcDir`: directory, or an array of directories, containing your source files (`.ts`, `.tsx`, `.js`, `.jsx`).
- `exclude` (optional): gitignore-flavored glob patterns for files and folders to skip. A name without a slash matches anywhere by basename (`__generated__`), a path with a slash is anchored to the project root (`src/legacy`), `**` matches any depth, `*.generated.ts` matches files, and a leading `!` re-includes. A `!` re-include always wins regardless of order but, as in gitignore, it cannot re-include a path whose parent directory is excluded, because excluded directories are not traversed. `node_modules` and `.git` are always excluded; a `!node_modules` pattern cannot re-include them.
- `excludedFolders` (optional, deprecated in favor of `exclude`): folder names or root-relative paths. Still honored and merged into the same matcher.
- `usagePatterns` (optional): templates used to detect operation usage. Defaults to the table above when omitted.
- `fragmentUsagePatterns` (optional): templates for detecting fragments referenced directly in source (fragment masking). Defaults to `{Name}FragmentDoc`.

For monorepos or projects with scattered operations, `graphqlDir` and `srcDir` accept a list of directories:

```yaml
graphqlDir:
  - ./packages/web/graphql
  - ./packages/admin/graphql
srcDir:
  - ./packages/web/src
  - ./packages/admin/src
```

### Without a config file (CLI flags)

Every config field has a matching flag, so you can run gqlPrune without a `gqlPrune.config.yaml`. That makes a one-off `npx` run possible with no setup:

```bash
npx gqlprune --graphql ./graphql --src ./src --exclude __generated__
```

| Flag                                                                   | Config field            |
| ---------------------------------------------------------------------- | ----------------------- |
| `--graphql <dir>` _(repeatable)_                                       | `graphqlDir`            |
| `--src <dir>` _(repeatable)_                                           | `srcDir`                |
| `--exclude <glob>` _(repeatable)_                                      | `exclude`               |
| `--ignore <folder>` _(repeatable, deprecated in favor of `--exclude`)_ | `excludedFolders`       |
| `--pattern <template>` _(repeatable)_                                  | `usagePatterns`         |
| `--fragment-pattern <template>` _(repeatable)_                         | `fragmentUsagePatterns` |

Both `--flag value` and `--flag=value` work, in any order. Precedence is simple: a flag overrides the same field in the YAML, flags alone work with no YAML, and YAML alone works exactly as before. A list flag such as `--exclude` replaces that list from the YAML rather than appending to it. An unknown flag, a flag missing its value, or an unknown command aborts with an error instead of being silently ignored.

## Usage

```bash
npx gqlprune
```

This prints any unused GraphQL operations and fragments. The command exits with:

- 0 when the scan completes and nothing unused is found (suitable for CI gates).
- 1 when the scan completes and unused operations or fragments are found. Exit code 1 always means findings, nothing else.
- 2 when the run itself fails: an unknown flag or command, a flag missing its value, no configuration, an unreadable config file, or a configured directory that doesn't exist. This lets a pipeline tell "clean up your GraphQL" (1) apart from "fix the pipeline" (2).

Print the installed version with `gqlprune --version` (or `-v`), and the full list of commands and flags with `gqlprune --help` (or `-h`).

### JSON output

Pass `--json` for a machine-readable report (CI, dashboards, scripting) instead of the human-readable tables:

```bash
npx gqlprune --json
```

```json
{
  "unusedOperations": [
    {
      "name": "GetUser",
      "type": "query",
      "file": "graphql/user.gql",
      "line": 1
    }
  ],
  "unusedFragments": [
    { "name": "UserFields", "file": "graphql/user.gql", "line": 8 }
  ],
  "warnings": [],
  "summary": { "unusedOperations": 1, "unusedFragments": 1 }
}
```

Only the JSON is written to stdout and the exit code is unchanged (0 clean, 1 unused, 2 error; see [Usage](#usage)), so it pipes cleanly into `jq` and CI gates. The `warnings` array carries advisory messages, currently a heads-up when a [generated file may be masking results](#avoiding-false-all-clear-results), and is empty when there are none.

### Verbose output

Pass `--verbose` to see why each operation was judged used or unused: the resolved configuration, the files scanned, and for each operation the exact search string that matched and the file it matched in.

```bash
npx gqlprune --verbose
```

```text
[verbose] graphqlDir: ./graphql
[verbose] srcDir: ./src
[verbose] exclude: node_modules, .git
[verbose] usagePatterns: use{Name}{Type}, use{Name}Lazy{Type}, use{Name}Suspense{Type}, {Name}Document
[verbose] fragmentUsagePatterns: {Name}FragmentDoc
[verbose] GraphQL files (1): graphql/user.gql
[verbose] Source files scanned: 42
[verbose] used:   GetUser (query) — "useGetUserQuery" found in src/App.tsx
[verbose] unused: OldQuery (query) — no match for useOldQueryQuery, useOldQueryLazyQuery, useOldQuerySuspenseQuery, OldQueryDocument
```

This is the fastest way to debug a surprising result. For an operation you believe is used, it shows exactly which patterns were searched, and if every operation matches in the same file, that file is almost certainly [generated output masking your results](#avoiding-false-all-clear-results). Verbose lines go to stderr, so `--verbose --json` still emits pure JSON on stdout.

### In CI

Add a script and run it in your pipeline; the non-zero exit fails the job when unused operations are found:

```json
{
  "scripts": {
    "gql:prune": "gqlprune"
  }
}
```

### GitHub Actions annotations

Under GitHub Actions, gqlPrune emits inline `::warning` annotations pointing at each unused operation or fragment (file and line), so they show up on the PR's Files changed tab. It turns on automatically when `GITHUB_ACTIONS` is set; force it anywhere with `--annotate`:

```bash
npx gqlprune --annotate
```

Annotations go to stderr, so they don't interfere with `--json` output on stdout (the two can be combined).

### Update notifications

gqlPrune checks npm (cached, at most once a day) and prints a one-line notice to stderr when a newer version is available. It stays silent in CI and when stdout isn't a TTY, never writes to stdout (so `--json` stays clean), and never affects the exit code. Opt out with `NO_UPDATE_NOTIFIER=1`; the check is also skipped whenever `CI` is set.

## Output

Unused operations and fragments are listed in separate sections: operations by type, name, and file; fragments by name and file.

```bash
--- Unused GraphQL Operations ---
Type     Operation       File
query    OperationName   operationFile.gql

--- Unused GraphQL Fragments ---
Fragment        File
FragmentName    fragmentFile.gql
```

## Contributing

Contributions are welcome; see [CONTRIBUTING.md](./CONTRIBUTING.md). This project uses [Conventional Commits](https://www.conventionalcommits.org/), and release-please automates releases and the changelog.

## Security

See [SECURITY.md](./SECURITY.md) for how to report a vulnerability.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)
