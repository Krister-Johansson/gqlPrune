# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What gqlPrune is

A schema-free CLI that finds **unused GraphQL operations and fragments**. It
scans `.gql`/`.graphql` files for definitions, then string-searches the source
tree to see whether each is referenced. No running server, schema, or
introspection required — that schema-free angle is the project's main
differentiator.

The output is a list of **candidates, not proof**: a string match can produce
false positives (dynamically built names, references in another repo, codegen
output). Keep that framing in user-facing text.

## Architecture

```
src/
  cli.ts                  Entry point: parses args, dispatches init | scan
  core/
    gqlPruner.ts          mainFunction orchestration + pure report/detect helpers
    configGenerator.ts    `gqlprune init` (interactive config via inquirer)
  utils/
    args.ts               parseArgs — command + --json / --annotate flags
    fileUtils.ts          findFilesWithExtension, readFileContents, exclusions
    operations.ts         extractOperations (graphql parse) → OperationInfo[]
    fragments.ts          findUnusedFragmentsInCorpus (cross-file spread graph)
    usagePatterns.ts      DEFAULT_*_PATTERNS, buildUsagePatterns, expandPattern
    stringHelpers.ts      small string utilities
  types/                  *.d.ts interfaces (GqlPruneConfig, OperationInfo, ...)
test/                     Jest specs, one per source module
```

**Design pattern that matters:** keep logic in small **pure, exported
functions** (e.g. `findUnusedOperations`, `buildJsonReport`, `formatAnnotations`).
`mainFunction` only wires them to the filesystem and console. This is what makes
the suite easy to test — mirror it for new work.

### I/O discipline

- In **`--json` mode, stdout carries only the JSON document.** Every diagnostic
  (info lines, warnings, GitHub annotations) goes to **stderr** so it never
  corrupts machine-readable output.
- Use `kleur` for colour. GitHub Actions annotations use the `::warning` /
  `::error` workflow-command format (see `formatAnnotations`).
- Prefer `process.exitCode = 1` over `process.exit(1)` on the reporting paths so
  buffered stdout flushes before the process ends.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Compile to `dist/` (`tsc`) |
| `npm test` | Run Jest |
| `npm run coverage` | Jest with coverage (thresholds enforced — see `jest.config.cjs`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config) |
| `npm run format` | Prettier |

**The local gate before any PR** (same checks CI runs on Node 20 + 22):

```bash
npm run build && npm run typecheck && npm run lint && npm test
```

Coverage thresholds live in `jest.config.cjs` (statements/functions/lines ≥ 90,
branches ≥ 75). New code must not drop coverage below the floor.

## How we work

A change moves through these stages. Don't skip ahead.

### 1. Research first
- Read the GitHub issue in full, plus any linked issues and the competitive
  research in `docs/research/`.
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

### 3. Branch & commit
- **Branch off `main`; never commit directly to `main`.**
  Name branches like `feat/22-warn-generated-srcdir` or `fix/...`.
- **Conventional Commits** — `release-please` derives the version and changelog
  from them. Use `feat:` (minor), `fix:` (patch), `docs:`, `chore:`, `ci:`,
  `refactor:`, `test:`. Scope when useful, e.g. `feat(scan): ...`.
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
  - Wrong / not applicable → reply explaining *why* and resolve it. Don't apply a
    change just to silence the bot.
- Re-run the local gate after addressing comments. CI must be green before merge.

### 6. Keep the board up to date
Treat the [project board](https://github.com/users/Krister-Johansson/projects/3)
as the source of truth for status — update it as work moves, not only at the end.
- **Starting:** move the issue's card to **In Progress**.
- **PR open:** the description must link the issue with `Closes #N`, so the
  **issue** auto-closes when the PR merges (visible in the PR's *Development*
  section).
- **Merged / finished:** make sure the card is **Done**. If the project's
  *Item closed → Done* workflow is enabled (Project ▸ ⋯ ▸ Workflows), closing the
  issue moves it automatically; otherwise move it by hand. Never leave shipped
  work sitting in Todo / In Progress.
- Keep statuses honest: if you spot an item that has shipped but still shows
  In Progress (or vice versa), fix it.

## Coding standards
- **TypeScript `strict: true`.** Must typecheck and lint clean.
- **Match the surrounding code** — naming, idioms, and comment density. Comments
  explain *why*, not *what*; this codebase favours a short JSDoc block on each
  exported function.
- ESM throughout: intra-repo imports use explicit `.js` specifiers (required by
  `module: node16`); ts-jest maps them back to `.ts` in tests.
- Keep changes small and focused.
