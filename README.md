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
[![Context7](https://img.shields.io/badge/Context7-verified-2ea44f)](https://context7.com/krister-johansson/gqlprune)

`gqlPrune` is a schema-free CLI: it finds unused GraphQL operations (queries, mutations, subscriptions) and unused fragments with no schema file, no running server, and no introspection step. It scans your `.gql`/`.graphql` files, then parses your TypeScript/JavaScript source and follows imports, re-exports and barrel files to check whether each operation is referenced, and whether each fragment is spread by an operation or referenced in source. What it reports are candidates for you to review rather than proof; see [Limitations](#limitations).

## Migrating from 3.x to 4.0

Usage detection changed engines. gqlPrune 3.x decided "used" with a whole-word text search over `srcDir`; 4.0 parses each source file with the TypeScript compiler and resolves imports, re-exports, barrel files, renamed and default imports before it judges an operation. What that means for an existing project:

- `typescript` is installed with gqlPrune. Only its parser and module resolver run; no program is created and no type checking happens, and your own TypeScript version is untouched.
- A name in a comment, in a string or in a template literal no longer counts as usage. An `import` that nothing reads does not count either, and a declaration of a pattern name never did on purpose. Expect an operation that was "used" only that way to be reported now, graded `low` when the bare name is still mentioned somewhere.
- Usage through a re-export, a barrel `index.ts`, a renamed import (`import { GetUserDocument as Doc }`), a default import or a namespace member is found, so some findings you had to dismiss by hand disappear.
- The JSON `reason` vocabulary changed. `source-mention` is gone; `name-referenced` (an identifier with the exact bare name is read somewhere) and `string-mention` (an exact string literal holds it) replace it, both graded `low`. `name-absent`, `generated-only` and `heuristic-cap` are unchanged, and no key changed shape. A script that switches on `reason` needs the two new values.
- A usage pattern must expand to an identifier. `use{Name}{Type}` and `{Name}Document` do; a pattern such as `{Name}.graphql` is rejected with exit code 2, because usage is decided by references to identifiers and such a pattern could never match.
- A source file that does not fully parse is read as far as it parsed, and the run warns and names it.
- Files outside the eight JavaScript and TypeScript extensions, such as a `.vue` file named in `sourceExtensions`, are scanned by their tokens without import resolution; see [Single-file components](#single-file-components).
- `--verbose` cites the file, line and column of the reference that decided a used operation, plus the import chain it went through, and the closing reminder line now reads "These are candidates from a static scan."

The human-readable sections, the exit codes, every configuration key and every JSON key are unchanged.

## Migrating from 2.x to 3.0

One field of the `--json` report changed shape. `orphanedFiles` used to be a list
of paths and is now a list of objects, so that each orphaned file carries the
same confidence grade as every other finding:

```diff
- "orphanedFiles": ["graphql/user.gql"]
+ "orphanedFiles": [{ "file": "graphql/user.gql", "confidence": "high", "reason": "name-absent" }]
```

A script that read the paths directly needs one change:

```diff
- report.orphanedFiles.forEach((file) => ...)
+ report.orphanedFiles.forEach(({ file }) => ...)
```

`summary.orphanedFiles` still counts them, and nothing else in the report
changed position or meaning. The human-readable output, the exit codes, and
every configuration key are unchanged.

## Migrating from 1.x to 2.0

- gqlPrune 2.x requires Node.js 20 or newer.
- The CLI command is `gqlprune` (lowercase), matching the package name. Both `npx gqlprune` and a global `gqlprune` work.
- Usage detection is broader and configurable. It now also matches lazy/suspense hooks and the generated `<Name>Document` constant, not just `use<Name><Type>`. If you use a different client (urql, react-query, raw documents, ...), set [`usagePatterns`](#configuration) so your operations aren't reported as unused.
- Folder exclusion works as documented: `excludedFolders` matches by folder name or root-relative path, and `node_modules` and `.git` are always excluded. (In 1.x the documented `node_modules` entry silently did nothing.)

## How it detects usage

An operation counts as used when something in your source references an identifier that resolves to one of the names derived from the operation. gqlPrune parses every `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` and `.cts` file with the TypeScript compiler (a parse only: nothing is executed and no type checker runs) and follows imports, `export ... from`, `export *`, barrel files, renamed and default imports back to the exported name. A call, an argument, a property access (`api.useGetUserQuery()`), a type annotation and a JSX tag are references; an unread `import`, a declaration, an object key, a comment and a string are not. By default `gqlPrune` looks for the conventions emitted by [GraphQL Code Generator](https://the-guild.dev/graphql/codegen) (the `typescript-react-apollo` / near-operation-file presets):

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

Documents are found on the parsed syntax tree, so a tag written inside a comment or a string is never a document and commented-out code produces no findings.

Each embedded document is parsed on its own and located against the file it sits in, so a finding points at the source file and the real line inside it (`src/User.tsx:12` rather than line 1). A body that does not parse, such as a half-written template or an operation name built by interpolation, is skipped and counted; `--verbose` prints how many. Interpolations like `${UserFieldsFragmentDoc}` are blanked before parsing, which is how graphql-tag treats them anyway, and the names inside them still count as references to the documents they name. Fragments resolve across both worlds: a fragment defined in a `.tsx` file and spread from a `.gql` operation counts as used, and so does the reverse.

The pass is off by default because turning it on changes what a scan is. A source file becomes both a place where documents are defined and a place where usage is looked for, and those two roles have to be kept apart or every document would find itself. The syntax tree keeps them apart: a document's body is a string literal, never an identifier, and the constant it is assigned to is a declaration, never a reference. So a document never counts as its own usage, and `const GetUserDocument = graphql('query GetUser { ... }')` does not make `GetUser` look used through the `{Name}Document` pattern when nothing reads the constant.

That constant is a usage signal in its own right. Under the client preset, `const q = graphql('query GetUser { ... }')` followed by `useQuery(q)` never writes the operation name outside the document, so no usage pattern can match it. gqlPrune therefore counts an inline document as used when the constant it is assigned to is referenced, in its own file or through an import from another one. The reference has to resolve to that constant: two files that both call their document `query` do not vouch for each other.

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

Read it as a starting shortlist, not a verdict. The field check is still a text search over the source files, the one place in gqlPrune that is, and a text search cannot see how your code consumes data, so this check errs in both directions:

- It flags fields you do use. A field reached through a computed key (`user[fieldKey]`, where the key comes from a variable or a list of column names), spread into props (`<Avatar {...user} />`), serialized whole, or consumed by a different repository never appears by name in `srcDir`. Renaming while destructuring is safe, though: `const { avatarUrl: avatar } = user` still writes `avatarUrl` out, so the match finds it.
- It stays quiet about fields you don't use. A field with a common name (`id`, `name`, `title`, `url`) matches somewhere in any real codebase, so it can never be flagged, even when it is genuinely dead.

Removing a field also changes the response shape for every consumer of that operation, which no schema-free tool can check for you. Verify each candidate by hand before trimming it.

### Avoiding false "all clear" results

GraphQL Code Generator output that lives inside `srcDir` is a trap: a single generated file (such as `src/gql/graphql.ts`) references every `{Name}Document` constant from inside the hook it declares for it, so everything looks used and nothing is ever reported unused, with no error to tell you so.

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
Found 1 selection of deprecated schema fields or enum values. It is advisory and does not affect the exit code.
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
    "deprecatedUsages": 1,
    "byConfidence": { "high": 0, "medium": 0, "low": 0 }
  }
}
```

If the file named by `schemaFile` cannot be read or is not valid SDL, the run stops with exit code 2 rather than skipping the check silently.

### Confidence grades

Every candidate carries a grade that answers one question: how much evidence is there that something references the definition anyway, even though no usage pattern matched?

That evidence comes from the same parse. The scan itself looks for references to the identifiers your usage patterns expand to, such as `useGetUserQuery` and `GetUserDocument`. The grading also looks for the bare definition name, `GetUser`, both as an identifier and inside string literals, which the usage check never does.

- **high** (`name-absent`): the name appears nowhere in the scanned source, neither as an identifier nor inside a string.
- **medium** (`generated-only`): the name appears only in files that look generated (see [Avoiding false "all clear" results](#avoiding-false-all-clear-results)), so the mention is probably codegen output rather than hand-written use.
- **low** (`name-referenced`): an identifier with exactly that name is read in ordinary source, but nothing that resolves to a usage pattern. A naming convention gqlPrune does not know about, or a lookup by name, is plausible; check `usagePatterns`.
- **low** (`string-mention`): the name appears inside a string in ordinary source. A registry key or a telemetry event may be building the reference at runtime; check where that string goes.

Unused operations, unused fragments and orphaned files are all graded. An orphaned file takes the lowest grade among the definitions it holds, because one definition that still looks live undermines the verdict on the whole file.

Field candidates never rise above medium (`heuristic-cap`), whatever the name evidence says. They come from a name-absence heuristic that cannot see a field read through a rename, a spread, or a computed key, so calling one of them high confidence would claim more than the check can know.

Deprecated selections carry no grade. They are validated against a real schema, so they are facts rather than candidates.

The grade appears as a column in the human tables, as `confidence` and `reason` on each finding in the JSON report, and in the text of each GitHub Actions annotation. Grading changes nothing about the framing: a high-confidence finding is still a candidate you should check before deleting.

Use `--min-confidence <level>`, or `minConfidence` in the config file, to decide which findings are reported. Because the exit code follows what is reported, this is also the CI gate:

```bash
# Fails the build only on findings whose name appears nowhere in the source.
npx gqlprune --min-confidence high
```

```yaml
minConfidence: high
```

Findings below the level are left out of the report, so one repository can fail CI on `high` while a developer runs `npx gqlprune` locally and reviews everything. Omit the setting and nothing is filtered, which is the default. A value other than `high`, `medium` or `low` stops the run with exit code 2. `--verbose` prints the grade and the evidence behind it for every finding, including the ones the gate hid.

## Limitations

### Operations and fragments, not fields

gqlPrune reports whole operations and fragments that nothing references. The default scan stops there: it does not inspect the fields inside an operation that is used, so over-fetching goes unreported. The opt-in `--fields` / `checkFields` heuristic covers exactly that ground, but what it produces is an advisory shortlist of candidates rather than a verdict (see [Field candidates (opt-in)](#field-candidates-opt-in)). Deciding it precisely requires a schema and data-flow analysis, which is why that sits outside the schema-free design; it is tracked in [issue #25](https://github.com/Krister-Johansson/gqlPrune/issues/25).

### Results are candidates, not proof

Usage detection is a static read of `srcDir`: the source is parsed, never run. An operation is reported as unused when no reference resolves to one of its identifiers, and that is not the same as the operation being unreachable. Three cases produce false positives:

- The operation name is assembled at runtime, for example by string concatenation or a lookup table, so the identifier never appears in the source.
- The code that uses it lives outside the configured `srcDir`, or in a file type gqlPrune does not parse (it parses `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` and `.cts`).
- Another repository consumes it, for example a shared GraphQL package that several applications import.

Check each finding before you delete it. Its [confidence grade](#confidence-grades) says how much corroborating evidence there is, and `--verbose` prints, for a used operation, the reference that decided it and the import chain behind it, and for an unused one the identifiers looked for, which usually explains a surprising result quickly.

### Single-file components

Vue, Svelte and Astro files are not parsed as modules. A file whose extension is not one of the eight above but is named in `sourceExtensions` is scanned by its tokens instead: every identifier in it counts as a reference by name, strings count as mentions, and imports inside it are not resolved. That keeps a `.vue` file's `useGetUserQuery()` call visible, but a hook it reaches through a renamed import is not followed. Extracting the `<script>` block and parsing it as a module is a planned follow-up.

### Generated code can hide findings

The opposite failure also happens: codegen output inside `srcDir` references every operation, so everything looks used and nothing is reported. gqlPrune warns you when it spots this; see [Avoiding false "all clear" results](#avoiding-false-all-clear-results).

## Setup

### Installation

Requires Node.js 20 or newer.

```bash
npm install --save-dev gqlprune
```

### Configuration

Run the `init` command to generate `gqlPrune.config.yaml` at the root of your project. It auto-detects your GraphQL and source directories (scanning the project and skipping `node_modules`, `.git`, and `dist`) and offers them as defaults you can accept or override. If the project has a [GraphQL Code Generator config](#reading-your-codegen-config), `init` takes the defaults from there instead, says which file they came from, and writes all of them into `gqlPrune.config.yaml`, `usagePatterns` and `inline` included. It has to: a config that names `graphqlDir` and `srcDir` stops gqlPrune from reading your codegen config on later runs, so a derived setting left out of the file would be gone. The one exception is a derived `schemaFile` whose path is not on disk yet, because it is downloaded or generated at build time. `init` leaves that one out, and does not list it either, rather than writing a path that would end every later run with exit code 2. It also detects a generated file that would mask your results (the [false "all clear"](#avoiding-false-all-clear-results) trap) and pre-fills it into `exclude`, so your first run is truthful. After writing the file it prints a preview of what a real run would find:

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
# Optional — which identifiers count as a use of an operation. Each pattern
# must expand to an identifier. Supports {name}, {Name}, {type}, {Type}.
usagePatterns:
  - use{Name}{Type}
  - '{Name}Document'
# Optional — which identifiers count as a use of a fragment (e.g. masking).
# Supports {name}, {Name} placeholders.
fragmentUsagePatterns:
  - '{Name}FragmentDoc'
# Optional: also list selected fields whose name appears nowhere in srcDir.
# Advisory only; off by default.
checkFields: true
# Optional: also scan gql`...` templates and graphql() calls in srcDir.
# Off by default.
inline: true
# Optional: report only findings graded at this confidence or above.
# One of high, medium, low. Everything is reported when omitted.
minConfidence: high
```

- `graphqlDir`: directory, array of directories, or glob pattern (`packages/*/graphql`) covering your `.gql`/`.graphql` files.
- `srcDir`: directory, array of directories, or glob pattern covering your source files.
- `sourceExtensions` (optional): the file extensions to scan for usage. Defaults to `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts` and `.cts`, the extensions the parser takes. Single-file component formats are not scanned unless you name them, so a Vue, Svelte or Astro project needs `sourceExtensions: ['.vue']` or the equivalent, and such files are then scanned by their tokens (see [Single-file components](#single-file-components)). A scan that reads no source file at all warns and tells you this, because every operation would otherwise look unused.
- `exclude` (optional): gitignore-flavored glob patterns for files and folders to skip. A name without a slash matches anywhere in the tree (`__generated__`), a path with a slash is anchored to the project root (`src/legacy`), `**` matches any depth, `*.generated.ts` matches files, and a leading `!` re-includes. Excluding a directory excludes everything under it, and `./src/gql`, `src/gql/` and `src/gql` are the same pattern written three ways. A `!` re-include always wins regardless of order but, as in gitignore, it cannot re-include a path whose parent directory is excluded, because excluded directories are not traversed. `node_modules` and `.git` are always excluded; a `!node_modules` pattern cannot re-include them.
- `excludedFolders` (optional, deprecated in favor of `exclude`): folder names or root-relative paths. Still honored and merged into the same matcher.
- `usagePatterns` (optional): templates for the identifiers that count as a use of an operation. Each must expand to an identifier. Defaults to the table above when omitted.
- `fragmentUsagePatterns` (optional): templates for the identifiers that count as a use of a fragment directly in source (fragment masking). Defaults to `{Name}FragmentDoc`.
- `schemaFile` (optional): path to a local SDL file. Turns on the [deprecated-usage check](#deprecated-selections-opt-in); omit it and no schema is read.
- `codegenConfig` (optional): path to a GraphQL Code Generator config to derive settings from, for a config that does not sit in the project root. See [reading your codegen config](#reading-your-codegen-config).
- `checkFields` (optional): set to `true` to add the advisory [field candidates](#field-candidates-opt-in) list. Off by default.
- `inline` (optional): set to `true` to also scan [inline documents](#inline-documents-opt-in) in `srcDir`. Off by default.
- `minConfidence` (optional): `high`, `medium` or `low`. Reports only findings graded at that level or above, which is also what the exit code follows (see [Confidence grades](#confidence-grades)). Everything is reported when omitted.

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

`*` matches one path segment and `**` matches any depth, so `packages/**/graphql` also finds nested workspaces. A pattern ending in `**` covers the directory it names as well as everything under it, so `src/**` scans `src` itself. Quote the pattern in YAML, since a value starting with `*` is not valid YAML otherwise. `node_modules` and `.git` are never searched. A glob never expands inside them either, so a pattern such as `node_modules/*/graphql` matches nothing rather than reaching in. A pattern that matches no directory ends the run with exit code 2, the same as a directory that does not exist, so a typo or a moved folder cannot pass as a clean scan.

### Reading your codegen config

If your project already uses GraphQL Code Generator, most of what gqlPrune needs is written down in its config. gqlPrune reads it so you do not have to restate the same facts.

It looks in the current directory for the first of these that exists: `codegen.ts`, `codegen.mts`, `codegen.cts`, `codegen.js`, `codegen.mjs`, `codegen.cjs`, `codegen.yml`, `codegen.yaml`, `codegen.json`, and finally a `codegen` key in `package.json`. Point it at a config somewhere else with `--codegen <file>` or `codegenConfig` in `gqlPrune.config.yaml`.

This happens automatically only when nothing else says which directories to scan: no `graphqlDir`/`srcDir` in `gqlPrune.config.yaml` and no `--graphql`/`--src` on the command line. That is the run that would otherwise stop with "No configuration found", so reading a codegen config can only turn a refusal into a working scan. A project that is already configured behaves exactly as before. When you name a file with `--codegen`, it is read whichever way the rest of the project is configured, and a file that cannot be read ends the run with exit code 2.

What gqlPrune takes from each part:

| Codegen setting                          | Becomes                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `documents` globs                        | `graphqlDir` and `srcDir` (the file-name part of the glob is dropped)                              |
| `documents` globs starting `!`           | `exclude` entries                                                                                  |
| `documents` in `.ts`/`.tsx`/`.js`/`.jsx` | `inline: true`, so [inline documents](#inline-documents-opt-in) are scanned                        |
| `schema`, when it is a local SDL file    | `schemaFile`, which turns on the [deprecated-usage check](#deprecated-selections-opt-in)           |
| `generates` output paths                 | `exclude` entries, so generated code cannot [mask your results](#avoiding-false-all-clear-results) |
| preset and plugin names                  | `usagePatterns` and `fragmentUsagePatterns` (see the table below)                                  |

A `schema` that is a URL, an introspection endpoint, a glob covering several files, or a value with a `${...}` in it is ignored: `schemaFile` takes one local SDL file.

Explicit configuration fails loudly, and inference degrades gracefully. A setting you wrote in `gqlPrune.config.yaml` or passed as a flag ends the run with exit code 2 when it does not resolve, because you asked for it. A setting gqlPrune worked out from your codegen config never does: it is dropped, gqlPrune warns you which one and which file it came from, and the scan carries on. So a `schema` path that is not on disk yet, because it is downloaded or generated at build time, costs you the deprecated-selection check and a warning, not a failed run. Same for a `documents` glob pointing at a directory this checkout does not have: gqlPrune scans the directories that do exist and names the one it skipped. Only when nothing derived is left to scan does the run stop, and then the message names the codegen config so you know where the paths came from.

Precedence runs in one direction: CLI flags beat `gqlPrune.config.yaml`, which beats anything derived from your codegen config, which beats the built-in defaults. An inferred setting is never silent. In a normal run gqlPrune names the file and the settings that came from it, and `--verbose` prints every derived value. In `--json` mode the same line goes to stderr, so stdout stays pure JSON and a CI job is still told which file configured its scan. The line says where the settings came from, so it is not repeated in the report's `warnings` array.

Because deriving stops once a config names the directories, `gqlprune init` writes the settings it derived into the file it generates (see [Configuration](#configuration)). Run it on an apollo-angular project and the generated config carries `usagePatterns: ['{Name}GQL', '{Name}Document']`, so your operations keep matching the code your plugin generates.

A `codegen.ts` (or any other JavaScript or TypeScript config) is read as text, never executed. Running your config would mean running arbitrary code to produce values that are only ever defaults, so gqlPrune pulls out the string literals it needs instead. A value that is computed, imported, spread, or built from a template with `${...}` in it cannot be read this way and is skipped, which costs you one suggestion and nothing else. YAML and JSON configs are parsed normally.

#### Which naming conventions are recognized

Each plugin generates code under its own naming convention, and that convention is what `usagePatterns` has to match. Recognizing one **replaces** the built-in patterns rather than adding to them: every extra pattern is another way for a dead operation to look used, and a silent all clear is the worst result this tool can give you.

| Plugin or preset            | Derived `usagePatterns`                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript-react-apollo`   | `use{Name}{Type}`, `use{Name}Lazy{Type}`, `use{Name}Suspense{Type}`, `{Name}Document`                                                    |
| `typescript-urql`           | `use{Name}{Type}`, `{Name}Document`                                                                                                      |
| `typescript-vue-apollo`     | `use{Name}{Type}`, `use{Name}Lazy{Type}`, `{Name}Document`                                                                               |
| `typescript-vue-urql`       | `use{Name}{Type}`, `{Name}Document`                                                                                                      |
| `typescript-react-query`    | `use{Name}{Type}`, `useInfinite{Name}{Type}`, `useSuspense{Name}{Type}`, `useSuspenseInfinite{Name}{Type}`, `{Name}Document`             |
| `typescript-solid-query`    | `create{Name}{Type}`, `createInfinite{Name}{Type}`, `createSuspense{Name}{Type}`, `createSuspenseInfinite{Name}{Type}`, `{Name}Document` |
| `typescript-apollo-angular` | `{Name}GQL`, `{Name}Document`                                                                                                            |
| `typed-document-node`       | `{Name}Document`                                                                                                                         |
| `client` preset             | no patterns; sets `inline: true` instead                                                                                                 |

Every plugin in the table also derives `fragmentUsagePatterns: ['{Name}FragmentDoc']`, which is what all of them call a fragment constant. The `client` preset is the exception to the whole idea of a pattern: your code writes `const q = graphql('query GetUser ...')` and then passes `q` around, so the operation's name never appears at the call site and no pattern could find it. The inline scan follows the constant instead.

Four conventions are left out on purpose, and a project using them keeps the built-in patterns:

- `typescript-document-nodes` names its constant after the operation and nothing else (`GetUser`), and `typescript-graphql-request` calls its SDK method the same way (`sdk.GetUser(...)`). A bare `{Name}` pattern matches any identifier that happens to share the name, so it would report far too much as used.
- `typescript-operations` generates types only. Importing the `GetUserQuery` type says nothing about whether the operation still runs.
- `near-operation-file` changes where the output files are written, not what anything is called.

Two codegen options change the generated names in a way gqlPrune does not follow: `omitOperationSuffix` drops the `Query`/`Mutation`/`Subscription` suffix, and `dedupeOperationSuffix` drops it when the operation name already ends with it. If you use either, set `usagePatterns` yourself.

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
| `--codegen <file>`                                                     | `codegenConfig`         |
| `--fields`                                                             | `checkFields`           |
| `--inline`                                                             | `inline`                |
| `--min-confidence <level>`                                             | `minConfidence`         |

`--graphql` and `--src` take the same glob patterns as their YAML fields; quote them (`--graphql 'packages/*/graphql'`) so the shell passes the pattern through instead of expanding it first.

Both `--flag value` and `--flag=value` work, in any order. Precedence is simple: a flag overrides the same field in the YAML, flags alone work with no YAML, and YAML alone works exactly as before. A list flag such as `--exclude` replaces that list from the YAML rather than appending to it. An unknown flag, a flag missing its value, a value outside a flag's fixed set (`--min-confidence`), or an unknown command aborts with an error instead of being silently ignored.

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
      "line": 1,
      "confidence": "high",
      "reason": "name-absent"
    }
  ],
  "unusedFragments": [
    {
      "name": "UserFields",
      "file": "graphql/user.gql",
      "line": 8,
      "confidence": "high",
      "reason": "name-absent"
    }
  ],
  "orphanedFiles": [
    {
      "file": "graphql/user.gql",
      "confidence": "high",
      "reason": "name-absent"
    }
  ],
  "deprecatedUsages": [],
  "warnings": [],
  "summary": {
    "unusedOperations": 1,
    "unusedFragments": 1,
    "orphanedFiles": 1,
    "deprecatedUsages": 0,
    "byConfidence": { "high": 3, "medium": 0, "low": 0 }
  }
}
```

Only the JSON is written to stdout and the exit code is unchanged (0 clean, 1 unused, 2 error; see [Usage](#usage)), so it pipes cleanly into `jq` and CI gates. The `warnings` array carries advisory messages, currently a heads-up when a [generated file may be masking results](#avoiding-false-all-clear-results), and is empty when there are none. `deprecatedUsages` stays empty unless you configure a [schema file](#deprecated-selections-opt-in).

Each candidate carries its [confidence grade](#confidence-grades) and the `reason` behind it, and `summary.byConfidence` counts every graded finding in the report per level. Deprecated selections are the exception: the schema settled them, so they are not graded.

With `--fields`, the report gains an `unusedFields` array and a matching `summary.unusedFields` count:

```json
{
  "unusedFields": [
    {
      "field": "avatarUrl",
      "locations": [{ "file": "graphql/user.gql", "line": 4 }],
      "confidence": "medium",
      "reason": "heuristic-cap"
    }
  ],
  "summary": {
    "unusedOperations": 0,
    "unusedFragments": 0,
    "orphanedFiles": 0,
    "unusedFields": 1,
    "byConfidence": { "high": 0, "medium": 1, "low": 0 }
  }
}
```

Both keys are absent without the flag, so a consumer can tell "nothing found" from "never checked". One entry lists every place that key is selected.

### Verbose output

Pass `--verbose` to see why each operation was judged used or unused: the resolved configuration, the files scanned, and for each operation the identifier that was referenced, where, and through which imports.

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
[verbose] used:   GetUser (query) — "useGetUserQuery" referenced in src/App.tsx:12:17
[verbose]         via imported from './api' in src/App.tsx
[verbose]         via re-exported from './generated/graphql' in src/api/index.ts, which is outside the scanned files
[verbose] unused: OldQuery (query) — no reference to useOldQueryQuery, useOldQueryLazyQuery, useOldQuerySuspenseQuery, OldQueryDocument
[verbose] confidence: operation "OldQuery" is high (name-absent: the name appears in no scanned source file)
```

This is the fastest way to debug a surprising result. For an operation you believe is used, it shows exactly which identifiers were looked for, and if every operation is referenced in the same file, that file is almost certainly [generated output masking your results](#avoiding-false-all-clear-results). Verbose lines go to stderr, so `--verbose --json` still emits pure JSON on stdout.

### In CI

Add a script and run it in your pipeline; the non-zero exit fails the job when unused operations are found:

```json
{
  "scripts": {
    "gql:prune": "gqlprune"
  }
}
```

To fail the job on the strongest findings only, add the gate and keep reviewing the rest locally:

```json
{
  "scripts": {
    "gql:prune": "gqlprune --min-confidence high"
  }
}
```

See [Confidence grades](#confidence-grades) for what each level means.

### GitHub Actions annotations

Under GitHub Actions, gqlPrune emits inline `::warning` annotations pointing at each unused operation or fragment (file and line), at each orphaned file, and at each [deprecated selection](#deprecated-selections-opt-in) when a schema is configured, so they show up on the PR's Files changed tab. With `--fields`, each field candidate gets one annotation too, placed at its first selection. Every candidate annotation ends with its [confidence grade](#confidence-grades), for example `[confidence: high]`, so a reviewer can triage from the Files changed tab. It turns on automatically when `GITHUB_ACTIONS` is set; force it anywhere with `--annotate`:

```bash
npx gqlprune --annotate
```

Annotations go to stderr, so they don't interfere with `--json` output on stdout (the two can be combined).

A complete workflow that runs on every pull request and fails the job on high-confidence findings:

```yaml
name: gqlprune
on: [pull_request]
jobs:
  gqlprune:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx gqlprune --min-confidence high
```

Drop `--min-confidence high` to fail on every finding. The annotations need no extra step: `GITHUB_ACTIONS` is set in every job, so they are on.

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

Unused operations and fragments are listed in separate sections: operations by type, name, and file; fragments by name and file. A third section follows when a whole file is [orphaned](#orphaned-files), and a fourth when a [schema](#deprecated-selections-opt-in) is configured and something selects a deprecated field or enum value. `--fields` adds a fifth with the [field candidates](#field-candidates-opt-in), one row per selection and the key shown on its first row. Every candidate section has a Confidence column carrying its [grade](#confidence-grades); the deprecated section has none, because those selections are not graded.

```bash
--- Unused GraphQL Operations ---
Type     Operation       Confidence  File
query    OperationName   high        operationFile.gql

--- Unused GraphQL Fragments ---
Fragment        Confidence  File
FragmentName    low         fragmentFile.gql

--- Orphaned GraphQL Files ---
Confidence  File
low         graphql/deadFile.gql

--- Deprecated Field Usage ---
File               Line Message
graphql/user.gql   3    The field User.nickname is deprecated. Use displayName

--- Unused Field Candidates ---
Field       Confidence  Selected in
avatarUrl   medium      graphql/user.gql:4
                        graphql/post.gql:9

These are candidates from a static scan. Verify each one before deleting.
```

The closing line is a reminder, not a warning about your project: usage comes from reading your source, never from running it, so check a finding before removing it (see [Limitations](#limitations)). It prints whenever a candidate was reported, whether that is an unused operation, a fragment, an orphaned file or a field candidate, and never in `--json` mode. The deprecated section does not trigger it: those selections come from your schema, not from a scan of your source. The field-candidate section adds a caveat of its own above it, covering only the blind spots specific to fields.

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
