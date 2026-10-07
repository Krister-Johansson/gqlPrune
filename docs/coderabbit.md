# CodeRabbit

CodeRabbit is a GitHub App (`coderabbitai[bot]`) that reviews pull requests to `main`. Its settings live in `.coderabbit.yaml` at the repository root. CodeRabbit reads that file from the branch under review, so a pull request that changes it is reviewed with its own new settings.

## When it reviews

CodeRabbit reviews a pull request once, when it opens. A push to the branch does not start another review; comment `@coderabbitai review` when the fixes for the first review are ready. It skips drafts, release PRs (`chore(main): release`) and PRs from `dependabot[bot]`. The review profile is `chill`.

Reviews count against an hourly allowance. Spend them this way:

- Ask for `@coderabbitai review` (the commits since the last review) rather than `@coderabbitai full review` (the whole diff again).
- Do not request a review of commits an auto review already covered.
- Do not request reviews on release-please or Dependabot PRs.
- Space out PRs opened in a batch, about one review per 15 minutes. `@coderabbitai rate limit` shows what is left.
- A reply in a review thread asks CodeRabbit to check a pushed fix without using a review.

## What it skips

`package-lock.json` and `docs/research/`. `CHANGELOG.md` stays in scope: release-please PRs are not reviewed, so a change to it in a reviewed PR is a hand edit, which the Markdown rule flags. CodeRabbit's own defaults also skip `dist`, `node_modules`, images and directories named `generated`.

## What it flags

| Path                   | What CodeRabbit flags                                                                                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/**`               | Logic in `mainFunction` or `cli.ts` that belongs in a pure helper, stdout writes in `--json` mode other than the report, `process.exit` on a reporting path, unescaped annotations, missing `.js` specifiers, missing JSDoc on exports, network calls, `child_process`, `eval`, `createRequire`, new environment reads, new `any` |
| `test/**/*.test.ts`    | A behaviour change without a failing-first test, specs that drift from one `describe` per function                                                                                                                                                                                                                                |
| `test/e2e/**`          | Whole-output or snapshot assertions (except `contract.e2e.test.ts`), a fixture with its own config run from the wrong `cwd`                                                                                                                                                                                                       |
| `test/fixtures/**`     | A fixture file without its fixture comment; nothing else, since fixtures imitate a consumer's tree on purpose                                                                                                                                                                                                                     |
| `docs/adr/**`          | A new ADR whose status is not `proposed`                                                                                                                                                                                                                                                                                          |
| `**/*.md`              | Em and en dashes, Title Case headings, curly quotes, emojis, diff narration, findings described as proof instead of candidates, hand edits to `CHANGELOG.md`                                                                                                                                                                      |
| `.github/workflows/**` | Actions not pinned by SHA, broad permissions, `pull_request_target`, checkout without `persist-credentials: false`, event values interpolated into scripts, renamed required jobs                                                                                                                                                 |
| `package.json`         | A hand-edited `version`, a `files` entry that would publish tests or fixtures, a new runtime dependency without a reason                                                                                                                                                                                                          |
| `.coderabbit.yaml`     | A dropped path instruction, a `path_filters` entry that excludes source or tests, incremental reviews turned on                                                                                                                                                                                                                   |

Pre-merge checks warn and never block a merge; CI and the branch ruleset are the gate. The title check asks for a Conventional Commit written for users, because release-please turns `feat`, `fix` and `perf` titles into changelog lines. The linked issue check looks for out-of-scope changes. A custom check warns when a file under `src/` changed and no file under `test/` did.

The tools that run are ESLint (with the repository's `eslint.config.js`), actionlint, zizmor and gitleaks. Biome, Oxlint and LanguageTool are off: the repository lints with ESLint and has its own prose rules.

These features are off: poems, fortunes, label and reviewer suggestions, the finishing touches that commit code (docstrings, unit tests, simplify, autofix, CI fix, merge conflict resolution), issue enrichment and issue plans, and automatic chat replies. CodeRabbit's check run on the head commit is on; it is not a required check, and a review error does not fail it.

## Answering a review

Check each comment against the code before acting on it. CLAUDE.md, section 5, has the rules: apply a valid comment (with a test when it changes behaviour) and say what changed in the thread; reply with the reason when a comment is wrong and resolve it.

## Commands

Post these as top-level comments on the pull request.

| Command                       | Effect                                                       |
| ----------------------------- | ------------------------------------------------------------ |
| `@coderabbitai review`        | Reviews the commits since the last review. Uses one review.  |
| `@coderabbitai full review`   | Reviews the whole pull request again. Uses one review.       |
| `@coderabbitai resolve`       | Resolves all CodeRabbit threads.                             |
| `@coderabbitai rate limit`    | Shows the remaining review allowance without using a review. |
| `@coderabbitai configuration` | Shows the settings in effect and where each one came from.   |
