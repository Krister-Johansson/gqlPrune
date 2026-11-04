# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What gqlPrune is

A schema-free CLI that finds **unused GraphQL operations and fragments**. It
scans `.gql`/`.graphql` files for definitions, then parses the source tree
with the TypeScript compiler API and follows imports, re-exports and barrels
to see whether each is referenced. No running server, schema, or
introspection required — that schema-free angle is the project's main
differentiator.

The output is a list of **candidates, not proof**: a static read of the source
can produce false positives (names built at runtime, references in another
repo or in a file type the parser does not take, codegen output). Keep that
framing in user-facing text.

## Architecture

```text
src/
  cli.ts                  Entry point: parses args, dispatches init | scan
  core/
    gqlPruner.ts          mainFunction orchestration + pure report/detect helpers
    configGenerator.ts    `gqlprune init` (interactive config via inquirer)
  utils/
    args.ts               FLAGS/COMMANDS tables + parseArgs + formatHelp
    completions.ts        completionScript — bash/zsh/fish scripts from the tables
    fileUtils.ts          findFilesWithExtension, readFileContents, exclusions
    operations.ts         extractOperations (graphql parse) → OperationInfo[]
    fragments.ts          findUnusedFragmentsInCorpus (cross-file spread graph)
    orphans.ts            findOrphanedFiles (whole-file dead documents)
    deprecated.ts         findDeprecatedUsages (opt-in, needs a local SDL)
    fields.ts             findUnusedFieldCandidates (opt-in `--fields`): traced or name fallback
    selectionTree.ts      buildSelectionTree: an operation's response keys, fragments merged
    resultFlow.ts         traceCallSite: follows a call's result to the fields it reads
    inline.ts             extractInlineDocuments (opt-in `--inline`, sites from sourceModule)
    sourceModule.ts       parseSourceModule: one file → imports, exports, references, sites
    referenceIndex.ts     buildReferenceIndex: references resolved to canonical names
    moduleResolver.ts     createCorpusResolver: ts.resolveModuleName over the read files
    tsconfig.ts           loadCompilerOptions: baseUrl/paths from the nearest tsconfig
    codegen.ts            reads a GraphQL Code Generator config → derived defaults
    jsLexer.ts            comment/string/bracket skipping used by codegen
    confidence.ts         grade* helpers over the index → high/medium/low
    usagePatterns.ts      DEFAULT_*_PATTERNS, buildUsagePatterns, expandPattern
    stringHelpers.ts      small string utilities
  types/                  *.d.ts interfaces (GqlPruneConfig, OperationInfo, ...)
test/                     Jest specs, one per source module
  e2e/                    Separate suite: spawns the built CLI as a process
    cli.e2e.test.ts       Core scan: sections, --json, --annotate, --schema, globs
    inline.e2e.test.ts    --inline, including the two self-usage invariants
    codegen.e2e.test.ts   Derivation, precedence, degradation, init
    confidence.e2e.test.ts  Grades, reasons, --min-confidence
    interactions.e2e.test.ts  Every option at once, on one project
    resolution.e2e.test.ts  Usage through re-exports, barrels, renames, defaults
    fields.e2e.test.ts    Field candidates: traced, fallback, escapes, grades
    contract.e2e.test.ts  The JSON shape and the exit-code matrix, pinned
    completion.e2e.test.ts  The shell completion scripts
    packaging.e2e.test.ts   Pack, install, run the installed binary
  fixtures/e2e/           Static project trees the e2e cases scan
docs/                     User docs: docs.json and MDX pages, built by Docs7
website/                  Landing page: a separate project, not part of the package
  index.html              Vite entry point
  vite.config.ts          React plugin and the relative base './'
  src/                    App.tsx (the page), main.tsx (mount), styles.css
```

**Design pattern that matters:** keep logic in small **pure, exported
functions** (e.g. `findUnusedOperations`, `buildJsonReport`, `formatAnnotations`).
`mainFunction` only wires them to the filesystem and console. This is what makes
the suite easy to test — mirror it for new work.

### I/O discipline

- In **`--json` mode, stdout carries only the JSON document.** Human-readable
  diagnostics (info lines, warnings, GitHub annotations) go to **stderr** so they
  never corrupt it; advisory warnings are _also_ serialized into the JSON
  `warnings` array as data.
- Use `kleur` for colour. In CI (`--annotate` / `GITHUB_ACTIONS`), warnings and
  per-finding annotations use the GitHub `::warning` / `::error` workflow-command
  format, escaped via `escapeAnnotationMessage` (see `formatAnnotations`).
- Prefer `process.exitCode = 1` over `process.exit(1)` on the reporting paths so
  buffered stdout flushes before the process ends.

## Commands

| Command             | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `npm run build`     | Compile to `dist/` (`tsc`)                                       |
| `npm test`          | Run Jest (unit suite only)                                       |
| `npm run test:e2e`  | Build, then run the e2e suite (`jest.e2e.config.cjs`)            |
| `npm run coverage`  | Jest with coverage (thresholds enforced — see `jest.config.cjs`) |
| `npm run typecheck` | `tsc --noEmit`                                                   |
| `npm run lint`      | ESLint (flat config)                                             |
| `npm run format`    | Prettier                                                         |

**The local gate before any PR** (same checks CI runs on Node 20 + 22):

```bash
npm run build && npm run typecheck && npm run lint && npm test && npm run test:e2e
```

Coverage thresholds live in `jest.config.cjs` (statements/functions/lines ≥ 90,
branches ≥ 80). New code must not drop coverage below the floor.

### The landing page (`website/`)

`website/` is a Vite, React and TypeScript site with its own `package.json`
and `package-lock.json`. Run its commands inside `website/`:

| Command           | What it does                                              |
| ----------------- | --------------------------------------------------------- |
| `npm ci`          | Install the site's own dependencies                       |
| `npm run dev`     | Vite dev server with hot reload                           |
| `npm run build`   | Typecheck (`tsc --noEmit`), then build to `website/dist/` |
| `npm run preview` | Serve the built `website/dist/` locally                   |

`.github/workflows/website.yml` builds the site on every pull request that
touches `website/` and deploys it to GitHub Pages
(https://krister-johansson.github.io/gqlPrune/) on a push to `main`. Its jobs
are not required checks. Deploying needs Settings > Pages > Source set to
"GitHub Actions".

The root gate above does not build the site. A change under `website/` needs
`npm ci && npm run build` inside `website/` to pass as well.

The site stays out of everything that belongs to the package. `files` in
`package.json` and `.npmignore` leave it out of the tarball, and the packaging
spec asserts that. The root `tsconfig.json` compiles only `src/`. ESLint and
the unit Jest config ignore `website/`. Dependabot updates it under its own
entry, `socket.yml` scans its manifests, and `context7.json` leaves it out of
the indexed docs. CodeQL does analyze it, on purpose.

### The user docs (`docs/`)

`docs/` holds the user documentation: `docs.json` (navigation, colours) and
one `.mdx` page per topic. Context7's Docs7 builds the hosted site from it,
and Context7 indexes the same raw MDX for coding agents (`context7.json` has
`"folders": ["docs"]`). Preview locally with `npx @upstash/docs7 dev ./docs`.

The site publishes from the `docs-live` branch, not from `main`, so the docs
match the version on npm:

- The `docs-live` job in `release-please.yml` fast-forwards `docs-live` to the
  release commit after `npm publish` succeeds.
- `docs-publish.yml` (run by hand) publishes a docs-only fix between releases.
  It refuses when `src/`, `package.json` or `package-lock.json` changed since
  `docs-live`, because those wait for the release.

`test/docs.test.ts` fails when a flag in `FLAGS`, a key of `GqlPruneConfig`, a
`ConfidenceReason` or a JSON report key pinned by the contract spec is missing
from its reference page. A change to any of those needs the matching docs
change in the same pull request. Pages follow the same prose rules as the rest
of the repo: no em or en dashes, sentence-case headings, and findings
described as candidates.

## How we work

A change moves through these stages. Don't skip ahead.

### 1. Research first

- Read the GitHub issue in full, plus any linked issues and the competitive
  research in `design/research/`.
- Read the code the change touches **before** proposing a design. Ground the
  plan in how the code actually behaves, not assumptions.
- Surface genuine design forks to the maintainer; pick sensible defaults for the
  rest and state them.

### 2. TDD

- **Write the failing test(s) first**, then implement until green. Tests are
  required for new functionality and fixes (see `CONTRIBUTING.md`).
- Test the **pure logic** directly (pattern expansion, detection, exclusion,
  report shaping). Drive `mainFunction` through the existing partial-mock setup
  in `test/gqlPruner.test.ts` (real pure helpers, mocked filesystem).
- Match the existing test style: `describe` per function, small focused `it`s,
  explicit expected values.
- Behaviour that only the shipped binary shows — exit codes, `--json` stdout
  purity, the packaged artifact — belongs in `test/e2e/` instead. Assert there on
  section headers, finding names, parsed JSON keys and exit codes; never on
  whole-output equality, which breaks on every added column.
  `contract.e2e.test.ts` is the one deliberate exception: it compares the JSON
  report's key sets exactly, because a changed key is a breaking change for
  every consumer, and it gathers the whole exit-code matrix in one place.
- Adding an e2e fixture: extend `test/fixtures/e2e/`, and give a scenario its
  own sub-project whenever it needs a config of its own. `gqlPrune.config.yaml`
  and the codegen config are both looked up in the process's working directory,
  so a project that carries either one must be run with `cwd` set to itself, or
  it will configure some other project's scan. Label every fixture file as a
  fixture in a comment; they are input data, never compiled. They stay out of
  the unit suite (`testPathIgnorePatterns`), out of coverage
  (`collectCoverageFrom`), out of lint (the `ignores` list in
  `eslint.config.js`) and out of the published package (`files` in
  `package.json`), and the packaging spec asserts the last of those.

### 3. Branch & commit

- **Branch off `main`; never commit directly to `main`.**
  Name branches like `feat/22-warn-generated-srcdir` or `fix/...`.
- **Conventional Commits** — `release-please` derives the version and changelog
  from them. Use `feat:` (minor), `fix:` (patch), `docs:`, `chore:`, `ci:`,
  `refactor:`, `test:`. Scope when useful, e.g. `feat(scan): ...`.
- **Site commits never use `feat:` or `fix:`.** Give a change to `website/`
  a `docs:`, `chore:` or `ci:` prefix. `release-please-config.json` lists
  `website` under `exclude-paths`, so release-please skips a commit whose files
  are all under `website/`. A commit that also touches the workflow or any root
  file is counted, and its prefix decides whether the CLI gets a release.
- **Never bump the version or edit `CHANGELOG.md` by hand** — release-please owns
  both. (See the release-process memory for the close/reopen CI stopgap.)

### 4. Open the PR

- Run the local gate above and make sure it's green.
- Push the branch and open a PR with a clear description: what, why, how tested.
  Link the issue with `Closes #N`.
- Keep the PR focused on one issue. Don't fold in unrelated cleanups.

### 5. CodeRabbit review — validate, don't rubber-stamp

CodeRabbit auto-reviews the PR. When its comments land:

- Read **every** comment.
- **Validate each one against the code before acting.** CodeRabbit is helpful but
  not always right — confirm the claim is real and the suggestion is correct and
  in keeping with this codebase.
  - Valid → apply it (with a test if it's a behaviour change) and reply noting
    what changed.
  - Wrong / not applicable → reply explaining _why_ and resolve it. Don't apply a
    change just to silence the bot.
- Re-run the local gate after addressing comments. CI must be green before merge.

**Mind the hourly review rate limit.** Reviews are budgeted per rolling hour, and
`.coderabbit.yaml` is configured to spend them only where they matter:

- **Incremental auto-reviews are off** — pushing fixes for review comments does
  _not_ trigger a re-review. When the fixes are ready for a re-check, request one
  explicitly by commenting `@coderabbitai review`.
- Prefer `@coderabbitai review` (incremental) over `@coderabbitai full review` —
  a full review re-reads the entire diff and costs accordingly. Never manually
  trigger a review when an auto review of the same commits already ran.
- release-please PRs (`chore(main): release`) and dependabot PRs are excluded
  from auto-review — don't request reviews on them either.
- When working through a queue of PRs, space them out; several PRs opened within
  the same hour can still exhaust the budget.

[`.github/coderabbit.md`](.github/coderabbit.md) lists what CodeRabbit flags per path,
the pre-merge checks, the tools it runs and its commands.

### 6. Keep the board up to date

Treat the [project board](https://github.com/users/Krister-Johansson/projects/3)
as the source of truth for status — update it as work moves, not only at the end.

- **Starting:** move the issue's card to **In Progress**.
- **PR open:** the description must link the issue with `Closes #N`, so the
  **issue** auto-closes when the PR merges (visible in the PR's _Development_
  section).
- **Merged / finished:** make sure the card is **Done**. If the project's
  _Item closed → Done_ workflow is enabled (Project ▸ ⋯ ▸ Workflows), closing the
  issue moves it automatically; otherwise move it by hand. Never leave shipped
  work sitting in Todo / In Progress.
- Keep statuses honest: if you spot an item that has shipped but still shows
  In Progress (or vice versa), fix it.

## Coding standards

- **TypeScript `strict: true`.** Must typecheck and lint clean.
- **Match the surrounding code** — naming, idioms, and comment density. Comments
  explain _why_, not _what_; this codebase favours a short JSDoc block on each
  exported function.
- ESM throughout: intra-repo imports use explicit `.js` specifiers (required by
  `module: node16`); ts-jest maps them back to `.ts` in tests.
- Keep changes small and focused.
