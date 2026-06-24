# gqlPrune: GraphQL Unused Operations Checker

[![npm](https://img.shields.io/npm/v/gqlprune)](https://www.npmjs.com/package/gqlprune)
[![npm downloads](https://img.shields.io/npm/dm/gqlprune)](https://www.npmjs.com/package/gqlprune)
[![node](https://img.shields.io/node/v/gqlprune)](https://www.npmjs.com/package/gqlprune)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[![CI](https://github.com/Krister-Johansson/gqlPrune/actions/workflows/ci.yml/badge.svg)](https://github.com/Krister-Johansson/gqlPrune/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Krister-Johansson/gqlPrune/branch/main/graph/badge.svg)](https://codecov.io/gh/Krister-Johansson/gqlPrune)
[![Socket Badge](https://socket.dev/api/badge/npm/package/gqlprune)](https://socket.dev/npm/package/gqlprune)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Krister-Johansson/gqlPrune/badge)](https://scorecard.dev/viewer/?uri=github.com/Krister-Johansson/gqlPrune)

`gqlPrune` is a utility that identifies unused GraphQL operations (queries, mutations, subscriptions) in your project. It scans `.gql`/`.graphql` files for named operations and checks whether they are referenced anywhere in your TypeScript/JavaScript source.

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
# Optional — override how usage is detected.
# Supports {name}, {Name}, {type}, {Type} placeholders.
usagePatterns:
  - use{Name}{Type}
  - '{Name}Document'
```

- `graphqlDir`: directory containing your `.gql`/`.graphql` files.
- `srcDir`: directory containing your source files (`.ts`, `.tsx`, `.js`, `.jsx`).
- `excludedFolders` _(optional)_: folder **names** (e.g. `__generated__`, matched anywhere in the tree) or **paths relative to the project root** (e.g. `src/legacy`). `node_modules` and `.git` are always excluded.
- `usagePatterns` _(optional)_: templates used to detect usage. Defaults to the table above when omitted.

## Usage

```bash
npx gqlprune
```

This prints any unused GraphQL operations. The command exits with:

- **0** when no unused operations are found (suitable for CI gates).
- **1** when unused operations are found (or on configuration errors).

### In CI

Add a script and run it in your pipeline; the non-zero exit fails the job when unused operations are found:

```json
{
  "scripts": {
    "gql:prune": "gqlprune"
  }
}
```

## Output

The utility outputs the operation type, name, and the file where it is defined:

```bash
Type     Operation       File
query    OperationName   operationFile.gql
```

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). This project uses [Conventional Commits](https://www.conventionalcommits.org/); releases and the changelog are automated with release-please.

## Security

See [SECURITY.md](./SECURITY.md) for how to report a vulnerability.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)
