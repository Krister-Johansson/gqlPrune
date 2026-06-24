# gqlPrune: GraphQL Unused Operations Checker

`gqlPrune` is a utility that identifies unused GraphQL operations (queries, mutations, subscriptions) in your project. It scans `.gql`/`.graphql` files for named operations and checks whether they are referenced anywhere in your TypeScript/JavaScript source.

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

## Output

The utility outputs the operation type, name, and the file where it is defined:

```bash
Type     Operation       File
query    OperationName   operationFile.gql
```
