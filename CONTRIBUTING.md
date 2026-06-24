# Contributing

Thanks for your interest in improving **gqlPrune**! This guide covers how to
report issues, set up a dev environment, and the standards a change needs to meet.

## Reporting bugs & requesting features

- **Bugs / features:** open a [GitHub issue](https://github.com/Krister-Johansson/gqlPrune/issues).
  For bugs, include your `gqlPrune.config.yaml`, a minimal `.gql` example, and the
  command output.
- **Security vulnerabilities:** please **do not** open a public issue — follow
  [`SECURITY.md`](./SECURITY.md) (private reporting via GitHub Security Advisories).

## Development setup

Prerequisite: **Node ≥ 20**.

```bash
git clone https://github.com/Krister-Johansson/gqlPrune
cd gqlPrune
npm install
```

Useful scripts:

| Command | What it does |
| ------- | ------------ |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run the Jest test suite |
| `npm run coverage` | Run tests with coverage |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config) |
| `npm run format` | Format with Prettier |

The source lives under `src/`: `src/core` (the pruner + config generator),
`src/utils` (file/operation/pattern helpers), and `src/cli.ts` (the entry point).

## Coding standards

- **TypeScript, `strict: true`.** Code must typecheck and lint with no errors.
- **Match the surrounding code** — naming, comment density, and idioms. Keep
  changes focused.

## Testing policy

**New functionality and bug fixes must come with tests** (`test/`, Jest). Cover the
pure logic — pattern expansion, folder exclusion, operation extraction, usage
detection.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) —
`release-please` derives versions and the changelog from them. Use `feat:`, `fix:`,
`docs:`, `chore:`, `ci:`, `refactor:`, `test:`, etc. Example:
`feat(detection): support urql document conventions`.

## Pull requests

1. Branch off `main`.
2. Make sure it passes locally: `npm run build && npm run typecheck && npm run lint && npm test`.
3. Open the PR with a clear description. CI must be green before merge.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT license](./LICENSE).
