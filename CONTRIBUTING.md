# Contributing

Thanks for your interest in improving gqlPrune! This guide covers how to report
issues, set up a dev environment, and the standards a change needs to meet.

## Reporting bugs and requesting features

- To report a bug or request a feature, open a
  [GitHub issue](https://github.com/Krister-Johansson/gqlPrune/issues). For bugs,
  include your `gqlPrune.config.yaml`, a minimal `.gql` example, and the command
  output.
- For security vulnerabilities, do not open a public issue. Follow
  [`SECURITY.md`](./SECURITY.md), which uses private reporting via GitHub
  Security Advisories.

## Development setup

You need Node.js 20 or newer.

```bash
git clone https://github.com/Krister-Johansson/gqlPrune
cd gqlPrune
npm install
```

Useful scripts:

| Command             | What it does                  |
| ------------------- | ----------------------------- |
| `npm run build`     | Compile TypeScript to `dist/` |
| `npm test`          | Run the Jest unit suite       |
| `npm run test:e2e`  | Build, then run the e2e suite |
| `npm run coverage`  | Run tests with coverage       |
| `npm run typecheck` | `tsc --noEmit`                |
| `npm run lint`      | ESLint (flat config)          |
| `npm run format`    | Format with Prettier          |

The source lives under `src/`: `src/core` (the pruner and config generator),
`src/utils` (file, operation, and pattern helpers), and `src/cli.ts` (the entry
point).

## Coding standards

- TypeScript with `strict: true`. Code must typecheck and lint with no errors.
- Match the surrounding code in naming, comment density, and idioms. Keep
  changes focused.

## Testing policy

New functionality and bug fixes must come with tests (`test/`, Jest). Cover the
pure logic: pattern expansion, folder exclusion, operation extraction, usage
detection.

Run the suite locally with `npm test` (or `npm run coverage` for the coverage
report). CI runs the same suite, plus build, typecheck, and lint, on Node 20
and 22 for every pull request, and those checks must pass before a merge. A
failing test names the spec and assertion that broke; the specs live next to
the module they cover, one file per source module.

`test/e2e/` is a second, separate suite. It spawns the built CLI as a real
process against the static project tree in `test/fixtures/e2e/`, and it packs
and installs the tarball to check the shipped artifact. Run it with
`npm run test:e2e`, which builds first. It is excluded from `npm test` and from
the coverage thresholds, which describe the unit suite. Assert there on section
headers, finding names, parsed JSON keys and exit codes, not on whole-output
equality: the report gains columns over time and a byte-exact expectation would
have to be rewritten for each one.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/);
release-please derives versions and the changelog from them. Use `feat:`, `fix:`,
`docs:`, `chore:`, `ci:`, `refactor:`, `test:`, and so on. Example:
`feat(detection): support urql document conventions`.

## Pull requests

1. Branch off `main`.
2. Make sure it passes locally: `npm run build && npm run typecheck && npm run lint && npm test`.
3. Open the PR with a clear description. CI must be green before merge.

## Code review

Every pull request gets an automated review (CodeRabbit) plus the maintainer's
review before merge. A review checks four things:

- Correctness: the change does what it claims, edge cases included, and comes
  with tests that fail without it.
- Fit: the code matches the surrounding style and the design rule in
  [docs/architecture.md](./docs/architecture.md) (pure functions wired by
  `mainFunction`), and the change stays focused on one issue.
- Security: no new execution of scanned input, no path handling that escapes
  the configured directories, no new dependencies without need (see
  [docs/security-policies.md](./docs/security-policies.md)).
- Documentation: user-visible changes update the README in the same pull
  request.

Review comments are resolved by fixing the code or by replying with a reason;
the branch ruleset requires every conversation resolved before merge.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT license](./LICENSE).
