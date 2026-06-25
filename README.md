# gqlPrune: GraphQL Unused Operations Checker

[![npm](https://img.shields.io/npm/v/gqlprune)](https://www.npmjs.com/package/gqlprune)
[![npm downloads](https://img.shields.io/npm/dm/gqlprune)](https://www.npmjs.com/package/gqlprune)
[![node](https://img.shields.io/node/v/gqlprune)](https://www.npmjs.com/package/gqlprune)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[![CI](https://github.com/Krister-Johansson/gqlPrune/actions/workflows/ci.yml/badge.svg)](https://github.com/Krister-Johansson/gqlPrune/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Krister-Johansson/gqlPrune/branch/main/graph/badge.svg)](https://codecov.io/gh/Krister-Johansson/gqlPrune)
[![Socket Badge](https://socket.dev/api/badge/npm/package/gqlprune)](https://socket.dev/npm/package/gqlprune)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Krister-Johansson/gqlPrune/badge)](https://scorecard.dev/viewer/?uri=github.com/Krister-Johansson/gqlPrune)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/13364/badge)](https://www.bestpractices.dev/projects/13364)

`gqlPrune` is a utility that identifies unused GraphQL operations (queries, mutations, subscriptions) **and unused fragments** in your project. It scans `.gql`/`.graphql` files and checks whether each operation is referenced in your TypeScript/JavaScript source, and whether each fragment is spread by an operation or referenced in source — all without needing a running server or schema.

## Migrating from 1.x to 2.0

- **Node.js ≥ 20** is now required.
- **The CLI command is `gqlprune`** (lowercase), matching the package name — `npx gqlprune` and a global `gqlprune` both work.
- **Usage detection is broader and configurable.** It now also matches lazy/suspense hooks and the generated `<Name>Document` constant, not just `use<Name><Type>`. If you use a different client (urql, react-query, raw documents, …), set [`usagePatterns`](#configuration) so your operations aren't reported as unused.
- **Folder exclusion now works as documented.** `excludedFolders` matches by folder name or root-relative path, and `node_modules`/`.git` are always excluded. (In 1.x the documented `node_modules` entry silently did nothing.)

## How it detects usage

An operation is considered **used** if any of a set of search strings derived from its name appears in your source files. By default `gqlPrune` looks for the conventions emitted by [GraphQL Code Generator](https://the-guild.dev/graphql/codegen) (the `typescript-react-apollo` / near-operation-file presets):

For an operation `query GetUser`, the defaults match:

| Pattern                  | Example                  |
| ------------------------ | ------------------------ |
| `use{Name}{Type}`        | `useGetUserQuery`        |
| `use{Name}Lazy{Type}`    | `useGetUserLazyQuery`    |
| `use{Name}Suspense{Type}`| `useGetUserSuspenseQuery`|
| `{Name}Document`         | `GetUserDocument`        |

If your project uses a different convention (urql, react-query, graphql-request, Vue, raw documents, etc.), override the patterns via `usagePatterns` in the config — see below. Without that, operations may be incorrectly reported as unused.

### Unused fragments

`gqlPrune` also reports **fragments that are never used**, across files and without a schema. A fragment is considered **used** when it is either:

- spread (directly or transitively) by **any** operation in your `.gql` corpus, or
- referenced in your source via a fragment pattern — by default the codegen `<Name>FragmentDoc` constant (e.g. under fragment masking). Override with `fragmentUsagePatterns`.

A fragment spread only by another _unused_ fragment is reported too. Note: a fragment is kept alive by any operation that spreads it, even an unused one — that operation is reported separately, so the fragment surfaces on the next run once you remove the operation.

## Setup

### Installation

Requires **Node.js ≥ 20**.

```bash
npm install --save-dev gqlprune
```

### Configuration

Run the `init` command to launch a configurator that generates `gqlPrune.config.yaml` at the root of your project:

```bash
npx gqlprune init
```

```yaml
graphqlDir: ./path/to/graphql
srcDir: ./src
excludedFolders:
  - __generated__
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

- `graphqlDir`: directory containing your `.gql`/`.graphql` files.
- `srcDir`: directory containing your source files (`.ts`, `.tsx`, `.js`, `.jsx`).
- `excludedFolders` _(optional)_: folder **names** (e.g. `__generated__`, matched anywhere in the tree) or **paths relative to the project root** (e.g. `src/legacy`). `node_modules` and `.git` are always excluded.
- `usagePatterns` _(optional)_: templates used to detect operation usage. Defaults to the table above when omitted.
- `fragmentUsagePatterns` _(optional)_: templates for detecting fragments referenced directly in source (fragment masking). Defaults to `{Name}FragmentDoc`.

## Usage

```bash
npx gqlprune
```

This prints any unused GraphQL operations and fragments. The command exits with:

- **0** when nothing unused is found (suitable for CI gates).
- **1** when unused operations or fragments are found (or on configuration errors).

### JSON output

Pass `--json` for a machine-readable report (CI, dashboards, scripting) instead of the human-readable tables:

```bash
npx gqlprune --json
```

```json
{
  "unusedOperations": [
    { "name": "GetUser", "type": "query", "file": "graphql/user.gql", "line": 1 }
  ],
  "unusedFragments": [
    { "name": "UserFields", "file": "graphql/user.gql", "line": 8 }
  ],
  "summary": { "unusedOperations": 1, "unusedFragments": 1 }
}
```

Only the JSON is written to stdout and the exit code is unchanged (0 clean / 1 unused), so it pipes cleanly into `jq` and CI gates.

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

Under GitHub Actions, gqlPrune emits inline **`::warning`** annotations pointing at each unused operation/fragment (file + line), so they show up on the PR's **Files changed** tab. It's enabled automatically when `GITHUB_ACTIONS` is set, or force it anywhere with `--annotate`:

```bash
npx gqlprune --annotate
```

Annotations go to **stderr**, so they don't interfere with `--json` output on stdout (the two can be combined).

## Output

Unused operations and fragments are listed in separate sections — operations by type, name, and file; fragments by name and file:

```bash
--- Unused GraphQL Operations ---
Type     Operation       File
query    OperationName   operationFile.gql

--- Unused GraphQL Fragments ---
Fragment        File
FragmentName    fragmentFile.gql
```

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). This project uses [Conventional Commits](https://www.conventionalcommits.org/); releases and the changelog are automated with release-please.

## Security

See [SECURITY.md](./SECURITY.md) for how to report a vulnerability.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)
