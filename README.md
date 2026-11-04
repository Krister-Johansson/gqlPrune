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

`gqlPrune` is a schema-free CLI that finds unused GraphQL operations (queries, mutations, subscriptions), unused fragments and orphaned `.gql` files. It needs no schema file, no running server and no introspection step. It reads your `.gql` and `.graphql` files, parses your TypeScript and JavaScript source, and follows imports, re-exports and barrel files to see whether anything still references each definition.

What it reports are candidates for you to review, not proof: a static read can miss a name built at runtime, a caller in another repository, or a file type the parser does not take. Each finding carries a confidence grade.

**Documentation: https://krister-johansson-gqlprune.docs7.io**

## Quick start

gqlPrune needs Node.js 20 or newer. Install it as a dev dependency:

```bash
npm install --save-dev gqlprune
```

Create `gqlPrune.config.yaml`. `init` detects your GraphQL and source directories, or takes them from your GraphQL Code Generator config when it finds one:

```bash
npx gqlprune init
```

Run a scan:

```bash
npx gqlprune
```

The [quickstart](https://krister-johansson-gqlprune.docs7.io/quickstart) walks through the output.

## Configuration

A minimal `gqlPrune.config.yaml` names where your documents and your source live:

```yaml
graphqlDir: ./graphql
srcDir: ./src
```

Every key has a matching CLI flag except `sourceExtensions`, and a flag overrides the file. The [config file reference](https://krister-johansson-gqlprune.docs7.io/configuration/config-file) describes every key, and [usage patterns](https://krister-johansson-gqlprune.docs7.io/concepts/usage-patterns) covers clients other than the default Apollo hooks.

## In CI

The exit code is 0 when nothing is reported, 1 when unused operations or fragments are reported, and 2 when the run itself fails. This script fails the job only on findings whose name appears nowhere in your source:

```json
{
  "scripts": {
    "gql:prune": "gqlprune --min-confidence high"
  }
}
```

Under GitHub Actions each finding also becomes an annotation on the pull request. See [GitHub Actions](https://krister-johansson-gqlprune.docs7.io/ci/github-actions), [exit codes](https://krister-johansson-gqlprune.docs7.io/reference/exit-codes) and the [JSON report](https://krister-johansson-gqlprune.docs7.io/reference/json-report).

## Upgrading

Each major version has a migration guide: [3.x to 4.0](https://krister-johansson-gqlprune.docs7.io/migration/v4), [2.x to 3.0](https://krister-johansson-gqlprune.docs7.io/migration/v3) and [1.x to 2.0](https://krister-johansson-gqlprune.docs7.io/migration/v2).

## Documentation

- [How detection works](https://krister-johansson-gqlprune.docs7.io/concepts/how-detection-works)
- [Confidence grades](https://krister-johansson-gqlprune.docs7.io/concepts/confidence)
- [Limitations](https://krister-johansson-gqlprune.docs7.io/concepts/limitations)
- [Findings](https://krister-johansson-gqlprune.docs7.io/findings/overview): unused operations and fragments, orphaned files, field candidates (`--fields`) and deprecated selections (`--schema`)
- [CLI reference](https://krister-johansson-gqlprune.docs7.io/reference/cli)
- [Troubleshooting](https://krister-johansson-gqlprune.docs7.io/troubleshooting)
- [For coding agents](https://krister-johansson-gqlprune.docs7.io/agents)

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
