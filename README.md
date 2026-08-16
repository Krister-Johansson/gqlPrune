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

`gqlPrune` is a schema-free CLI: it finds unused GraphQL operations (queries, mutations, subscriptions) and unused fragments with no schema file, no running server, and no introspection step. It scans your `.gql`/`.graphql` files, then checks whether each operation is referenced in your TypeScript/JavaScript source and whether each fragment is spread by an operation or referenced in source. What it reports are candidates for you to review rather than proof; see [Limitations](#limitations).

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

### Orphaned files

A `.gql`/`.graphql` file is orphaned when every operation and fragment it defines is unused and no other document pulls it in with an `#import "./file.gql"` comment. gqlPrune lists these files in their own section, because the whole file is a deletion candidate rather than a few definitions inside it.

Import comments are read from the raw file text (the convention used by graphql-tag and the webpack GraphQL loaders) and resolved against the importing file's directory, so `#import "./fields.gql"` keeps the `fields.gql` next to it off the list. Two cases never get flagged: a file that defines nothing, including one that fails to parse, and a file containing an anonymous operation, whose usage gqlPrune cannot track by name.

Orphaned files are candidates like everything else gqlPrune reports. A file may still be read by another repository, a runtime loader, or tooling this scan cannot see, so check before you delete it. The JSON report lists the paths under `orphanedFiles` and counts them in `summary.orphanedFiles`. They never change the exit code on their own: an orphaned file always holds unused definitions, and those already exit 1.

### Inline documents (opt-in)

By default gqlPrune reads documents only from `.gql` and `.graphql` files. Pass `--inline` (or set `inline: true` in the config) to also read the documents embedded in your TypeScript and JavaScript source:

```bash
npx gqlprune --inline
```

Two shapes are recognized, the ones graphql-tag, Apollo, urql and the GraphQL Code Generator client preset produce:

- Tagged templates: ``gql`query GetUser { ... }` `` and ``graphql`...` ``, including a tag reached through a member expression such as ``api.gql`...` ``.
- Helper calls taking a single string argument: `graphql('query GetUser { ... }')`, `graphql("...")`, ``graphql(`...`)``, and the same for `gql(...)`.

Each embedded document is parsed on its own and located against the file it sits in, so a finding points at the source file and the real line inside it (`src/User.tsx:12` rather than line 1). A body that does not parse, such as a half-written template or an operation name built by interpolation, is skipped and counted; `--verbose` prints how many. Interpolations like `${UserFieldsFragmentDoc}` are blanked before parsing, which is how graphql-tag treats them anyway, and the names inside them still count as references to the documents they name. Fragments resolve across both worlds: a fragment defined in a `.tsx` file and spread from a `.gql` operation counts as used, and so does the reverse.

The pass is off by default because turning it on changes what a scan is. A source file becomes both a place where documents are defined and part of the text searched for usage, and those two roles have to be kept apart or every document would find itself. gqlPrune keeps them apart by blanking each document, together with the statement that assigns it, out of the text it searches. So a document never counts as its own usage, and `const GetUserDocument = graphql('query GetUser { ... }')` does not make `GetUser` look used through the `{Name}Document` pattern when nothing reads the constant.

That constant is a usage signal in its own right. Under the client preset, `const q = graphql('query GetUser { ... }')` followed by `useQuery(q)` never writes the operation name outside the document, so no usage pattern can match it. gqlPrune therefore counts an inline document as used when the constant it is assigned to appears anywhere else in the scanned source, matched as a whole word. Read that with the same caution as everything else here: a constant called `query`, `doc` or `q` matches something unrelated in any real codebase and can hide a genuine finding, so give a document a distinctive name if you want the check to mean much for it.

Whole-file [orphan detection](#orphaned-files) never applies to a source file. A `.tsx` component whose only query is unused is not a dead file, and pointing you at it for deletion would be bad advice, so only `.gql`/`.graphql` files are ever listed as orphaned.

Inline documents also reach the opt-in checks below: with `--schema` they are validated for deprecated selections, and with `--fields` their fields contribute candidates, both reported against the source file.

### Field candidates (opt-in)

Operations and fragments are the default unit of detection. Pass `--fields` (or set `checkFields: true` in the config) to also get an advisory list of individual fields your app may be selecting without ever reading:

```bash
npx gqlprune --fields
```

gqlPrune collects the response key of every field selected by a **used** operation, and by the fragments those operations reach through the spread graph. The response key is the alias when a field is aliased (`nickname: displayName` contributes `nickname`), otherwise the field name. `__typename` is always skipped, and so are the fields of operations and fragments that are already reported unused, since those are reported whole.

A key becomes a candidate when it appears **nowhere** in any scanned source file. The test is a case-sensitive whole-word match, `\bkey\b`, so `id` matches `data.id` but not `video`.

The list is advisory. It prints after the other sections, adds `unusedFields` to the JSON report, emits one `::warning` annotation per key, and never changes the exit code.

Read it as a starting shortlist, not a verdict. A string search cannot see how your code consumes data, and this check errs in both directions:

- It flags fields you do use. A field reached through a computed key (`user[fieldKey]`, where the key comes from a variable or a list of column names), spread into props (`<Avatar {...user} />`), serialized whole, or consumed by a different repository never appears by name in `srcDir`. Renaming while destructuring is safe, though: `const { avatarUrl: avatar } = user` still writes `avatarUrl` out, so the match finds it.
- It stays quiet about fields you don't use. A field with a common name (`id`, `name`, `title`, `url`) matches somewhere in any real codebase, so it can never be flagged, even when it is genuinely dead.

Removing a field also changes the response shape for every consumer of that operation, which no schema-free tool can check for you. Verify each candidate by hand before trimming it.

### Avoiding false "all clear" results

Because usage is detected by string-matching `srcDir`, GraphQL Code Generator output that lives inside `srcDir` is a trap: a single generated file (such as `src/gql/graphql.ts`) references every operation, so everything looks used and nothing is ever reported unused, with no error to tell you so.

gqlPrune guards against this. When one source file alone references most of your operations, it prints a warning naming the file and pointing you at `exclude`:

> ⚠ Suspected generated file "src/gql/graphql.ts" references 100% of all operations (50/50) and looks generated — add it to "exclude" in gqlPrune.config.yaml or unused results will be unreliable.

Add it to `exclude` (for example `'**/*.generated.ts'`) and re-run, or run `gqlprune init`, which detects such a file and pre-fills it into `exclude` for you. The warning goes to stderr (so it also surfaces in `--json` mode) and is included in the JSON report's `warnings` array; it does not change the exit code.

### Deprecated selections (opt-in)

gqlPrune can also tell you where your operations still select fields or enum values the schema marks `@deprecated`. This is the one check that needs a schema, so it is opt-in: point gqlPrune at a local SDL file with `schemaFile` in the config or `--schema` on the command line.

```yaml
schemaFile: ./schema.graphql
```

```bash
npx gqlprune --schema ./schema.graphql
```

The file is read from disk. gqlPrune still never starts a server and never runs introspection, and with no `schemaFile` the check does not run at all, so the default scan stays schema-free.

Every `.gql`/`.graphql` file that parsed successfully is validated against the schema as one document, so a fragment spread resolves even when the fragment lives in another file. Only the deprecation rule runs: fields the schema does not define, duplicate names, and other mismatches are ignored rather than reported.

Findings are advisory. They print after the unused sections, they are emitted as `::warning` annotations under GitHub Actions, and they never change the exit code, which keeps meaning "unused operations or fragments were found".

```text
--- Deprecated Field Usage ---

File               Line Message
graphql/user.gql   3    The field User.nickname is deprecated. Use displayName
------------------------------
Found 1 selection of deprecated schema fields or enum values. They are advisory and do not affect the exit code.
```

In `--json` mode they appear as a `deprecatedUsages` array with a matching count in `summary`:

```json
{
  "deprecatedUsages": [
    {
      "message": "The field User.nickname is deprecated. Use displayName",
      "file": "graphql/user.gql",
      "line": 3
    }
  ],
  "summary": {
    "unusedOperations": 0,
    "unusedFragments": 0,
    "deprecatedUsages": 1
  }
}
```

If the file named by `schemaFile` cannot be read or is not valid SDL, the run stops with exit code 2 rather than skipping the check silently.

## Limitations

### Operations and fragments, not fields

gqlPrune reports whole operations and fragments that nothing references. The default scan stops there: it does not inspect the fields inside an operation that is used, so over-fetching goes unreported. The opt-in `--fields` / `checkFields` heuristic covers exactly that ground, but what it produces is an advisory shortlist of candidates rather than a verdict (see [Field candidates (opt-in)](#field-candidates-opt-in)). Deciding it precisely requires a schema and data-flow analysis, which is why that sits outside the schema-free design; it is tracked in [issue #25](https://github.com/Krister-Johansson/gqlPrune/issues/25).

### Results are candidates, not proof

Usage detection is a string search over `srcDir`. An operation is reported as unused when none of its search strings appear there, and that is not the same as the operation being unreachable. Three cases produce false positives:

- The operation name is assembled at runtime, for example by string concatenation or a lookup table, so the literal name never appears in the source.
- The code that uses it lives outside the configured `srcDir`, or in a file type gqlPrune does not read (it reads `.ts`, `.tsx`, `.js`, and `.jsx`).
- Another repository consumes it, for example a shared GraphQL package that several applications import.

Check each finding before you delete it. `--verbose` prints the exact search strings that were tried for every operation, which usually explains a surprising result quickly.

### Generated code can hide findings

The opposite failure also happens: codegen output inside `srcDir` references every operation, so everything looks used and nothing is reported. gqlPrune warns you when it spots this; see [Avoiding false "all clear" results](#avoiding-false-all-clear-results).

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

If your files sit under several top-level directories, as in a monorepo, `init` shows a checklist of those directories instead of defaulting to the project root. Every entry starts ticked; untick the ones you do not want. One directory is written as a string, several as a list. Untick everything and you get the plain path question back, with the project root as the default.

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
# Optional: also list selected fields whose name appears nowhere in srcDir.
# Advisory only; off by default.
checkFields: true
# Optional: also scan gql`...` templates and graphql() calls in srcDir.
# Off by default.
inline: true
```

- `graphqlDir`: directory, array of directories, or glob pattern (`packages/*/graphql`) covering your `.gql`/`.graphql` files.
- `srcDir`: directory, array of directories, or glob pattern covering your source files (`.ts`, `.tsx`, `.js`, `.jsx`).
- `exclude` (optional): gitignore-flavored glob patterns for files and folders to skip. A name without a slash matches anywhere by basename (`__generated__`), a path with a slash is anchored to the project root (`src/legacy`), `**` matches any depth, `*.generated.ts` matches files, and a leading `!` re-includes. A `!` re-include always wins regardless of order but, as in gitignore, it cannot re-include a path whose parent directory is excluded, because excluded directories are not traversed. `node_modules` and `.git` are always excluded; a `!node_modules` pattern cannot re-include them.
- `excludedFolders` (optional, deprecated in favor of `exclude`): folder names or root-relative paths. Still honored and merged into the same matcher.
- `usagePatterns` (optional): templates used to detect operation usage. Defaults to the table above when omitted.
- `fragmentUsagePatterns` (optional): templates for detecting fragments referenced directly in source (fragment masking). Defaults to `{Name}FragmentDoc`.
- `schemaFile` (optional): path to a local SDL file. Turns on the [deprecated-usage check](#deprecated-selections-opt-in); omit it and no schema is read.
- `checkFields` (optional): set to `true` to add the advisory [field candidates](#field-candidates-opt-in) list. Off by default.
- `inline` (optional): set to `true` to also scan [inline documents](#inline-documents-opt-in) in `srcDir`. Off by default.

For monorepos or projects with scattered operations, `graphqlDir` and `srcDir` accept a list of directories:

```yaml
graphqlDir:
  - ./packages/web/graphql
  - ./packages/admin/graphql
srcDir:
  - ./packages/web/src
  - ./packages/admin/src
```

An entry can also be a glob pattern, which gqlPrune expands to the directories it matches before scanning. That covers every package without naming them one by one, and picks up new packages on its own:

```yaml
graphqlDir: 'packages/*/graphql'
srcDir: 'packages/*/src'
```

`*` matches one path segment and `**` matches any depth, so `packages/**/graphql` also finds nested workspaces. Quote the pattern in YAML, since a value starting with `*` is not valid YAML otherwise. `node_modules` and `.git` are never searched. A glob never expands inside them either, so a pattern such as `node_modules/*/graphql` matches nothing rather than reaching in. A pattern that matches no directory ends the run with exit code 2, the same as a directory that does not exist, so a typo or a moved folder cannot pass as a clean scan.

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
| `--schema <file>`                                                      | `schemaFile`            |
| `--fields`                                                             | `checkFields`           |
| `--inline`                                                             | `inline`                |

`--graphql` and `--src` take the same glob patterns as their YAML fields; quote them (`--graphql 'packages/*/graphql'`) so the shell passes the pattern through instead of expanding it first.

Both `--flag value` and `--flag=value` work, in any order. Precedence is simple: a flag overrides the same field in the YAML, flags alone work with no YAML, and YAML alone works exactly as before. A list flag such as `--exclude` replaces that list from the YAML rather than appending to it. An unknown flag, a flag missing its value, or an unknown command aborts with an error instead of being silently ignored.

## Usage

```bash
npx gqlprune
```

This prints any unused GraphQL operations and fragments. The command exits with:

- 0 when the scan completes and nothing unused is found (suitable for CI gates).
- 1 when the scan completes and unused operations or fragments are found. Exit code 1 always means findings, nothing else.
- 2 when the run itself fails: an unknown flag or command, a flag missing its value, no configuration, an unreadable config file, a configured directory that doesn't exist, or a directory pattern that matches nothing. This lets a pipeline tell "clean up your GraphQL" (1) apart from "fix the pipeline" (2).

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
  "orphanedFiles": ["graphql/user.gql"],
  "deprecatedUsages": [],
  "warnings": [],
  "summary": {
    "unusedOperations": 1,
    "unusedFragments": 1,
    "orphanedFiles": 1,
    "deprecatedUsages": 0
  }
}
```

Only the JSON is written to stdout and the exit code is unchanged (0 clean, 1 unused, 2 error; see [Usage](#usage)), so it pipes cleanly into `jq` and CI gates. The `warnings` array carries advisory messages, currently a heads-up when a [generated file may be masking results](#avoiding-false-all-clear-results), and is empty when there are none. `deprecatedUsages` stays empty unless you configure a [schema file](#deprecated-selections-opt-in).

With `--fields`, the report gains an `unusedFields` array and a matching `summary.unusedFields` count:

```json
{
  "unusedFields": [
    {
      "field": "avatarUrl",
      "locations": [{ "file": "graphql/user.gql", "line": 4 }]
    }
  ],
  "summary": {
    "unusedOperations": 0,
    "unusedFragments": 0,
    "orphanedFiles": 0,
    "unusedFields": 1
  }
}
```

Both keys are absent without the flag, so a consumer can tell "nothing found" from "never checked". One entry lists every place that key is selected.

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

Under GitHub Actions, gqlPrune emits inline `::warning` annotations pointing at each unused operation or fragment (file and line), at each orphaned file, and at each [deprecated selection](#deprecated-selections-opt-in) when a schema is configured, so they show up on the PR's Files changed tab. With `--fields`, each field candidate gets one annotation too, placed at its first selection. It turns on automatically when `GITHUB_ACTIONS` is set; force it anywhere with `--annotate`:

```bash
npx gqlprune --annotate
```

Annotations go to stderr, so they don't interfere with `--json` output on stdout (the two can be combined).

### Update notifications

gqlPrune checks npm (cached, at most once a day) and prints a one-line notice to stderr when a newer version is available. It stays silent in CI and when stdout isn't a TTY, never writes to stdout (so `--json` stays clean), and never affects the exit code. Opt out with `NO_UPDATE_NOTIFIER=1`; the check is also skipped whenever `CI` is set.

### Shell completion

`gqlprune completion <shell>` prints a tab-completion script for bash, zsh, or fish. It completes the commands, every flag, and the shell names for `completion` itself; `--graphql`, `--src` and `--schema` fall back to your shell's own file completion.

Load it by adding one line to your shell config:

```bash
# ~/.bashrc
eval "$(gqlprune completion bash)"
```

```zsh
# ~/.zshrc
eval "$(gqlprune completion zsh)"
```

```fish
# ~/.config/fish/config.fish
gqlprune completion fish | source
```

gqlPrune never edits your rc files; the line above is yours to add and remove. The script only defines a completion function and registers it for the `gqlprune` command.

Completion needs `gqlprune` on your `PATH`, so it applies to global installs (`npm i -g gqlprune`) and to `npm link`. An `npx gqlprune` run and an npm script such as `npm run gql:prune` go through their own wrappers, which shells do not complete.

## Output

Unused operations and fragments are listed in separate sections: operations by type, name, and file; fragments by name and file. A third section follows when a whole file is [orphaned](#orphaned-files), and a fourth when a [schema](#deprecated-selections-opt-in) is configured and something selects a deprecated field or enum value. `--fields` adds a fifth with the [field candidates](#field-candidates-opt-in), one row per selection and the key shown on its first row.

```bash
--- Unused GraphQL Operations ---
Type     Operation       File
query    OperationName   operationFile.gql

--- Unused GraphQL Fragments ---
Fragment        File
FragmentName    fragmentFile.gql

--- Orphaned GraphQL Files ---
File
graphql/deadFile.gql

--- Deprecated Field Usage ---
File               Line Message
graphql/user.gql   3    The field User.nickname is deprecated. Use displayName

--- Unused Field Candidates ---
Field       Selected in
avatarUrl   graphql/user.gql:4
            graphql/post.gql:9

These are candidates from a string search. Verify each one before deleting.
```

The closing line is a reminder, not a warning about your project: usage comes from a string search, so check a finding before removing it (see [Limitations](#limitations)). It prints only when an operation or fragment is reported (the field-candidate section carries its own caveat), and never in `--json` mode.

## Contributing

Contributions are welcome; see [CONTRIBUTING.md](./CONTRIBUTING.md). This project uses [Conventional Commits](https://www.conventionalcommits.org/), and release-please automates releases and the changelog.

## Security

See [SECURITY.md](./SECURITY.md) for how to report a vulnerability.

### Verifying a release

Every release is verifiable. The npm package is published through Trusted
Publishing with Sigstore provenance; check your installed copy with:

```bash
npm audit signatures
```

The provenance must name this repository, built by GitHub Actions. Each GitHub
release also carries a CycloneDX SBOM of the runtime dependency tree, signed
with keyless cosign; verify it with:

```bash
cosign verify-blob \
  --bundle gqlprune-<version>.cdx.json.sigstore.json \
  --certificate-identity-regexp '^https://github.com/Krister-Johansson/gqlPrune/\.github/workflows/sbom\.yml@refs/tags/gqlprune-v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  gqlprune-<version>.cdx.json
```

[SECURITY.md](./SECURITY.md) has the full instructions, including the
certificate identity used for releases published before 2.11.2, whose
signatures were backfilled.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)
