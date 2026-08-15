# Security policy

## Supported versions

`gqlprune` follows semantic versioning. Security fixes are released against the
latest published version, so upgrade before reporting.

| Version        | Supported |
| -------------- | --------- |
| latest release | Yes       |
| older releases | No        |

Support covers bug fixes and security updates for the latest release only. A
release stops receiving security updates the moment a newer release is
published; there are no long-term support branches.

## Verifying a release

Every npm release is published from GitHub Actions through OIDC trusted
publishing with provenance, so you can check both integrity and origin:

```bash
npm audit signatures
```

The command verifies the registry signatures and Sigstore provenance
attestations of your installed packages, `gqlprune` included, and reports how
many packages have verified attestations. You can also inspect the provenance
on the package's npm page, which shows the source commit, workflow, and build
log for each version.

The expected identity in the attestation is this repository:
`Krister-Johansson/gqlPrune`, built by GitHub Actions from the
release-please workflow. Treat any version whose provenance names a different
repository or builder as compromised, and report it.

Each GitHub release also carries a CycloneDX software bill of materials
(`gqlprune-<version>.cdx.json`) as an asset, listing the exact runtime
dependency tree the release shipped with, along with a keyless Sigstore
signature bundle over it (`.sigstore.json`). Verify the SBOM with:

```bash
cosign verify-blob \
  --bundle gqlprune-<version>.cdx.json.sigstore.json \
  --certificate-identity-regexp '^https://github.com/Krister-Johansson/gqlPrune/\.github/workflows/sbom\.yml@refs/tags/gqlprune-v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  gqlprune-<version>.cdx.json
```

The certificate identity must be this repository's sbom.yml workflow running
on a release tag; treat anything else as compromised, and report it. One
exception: releases published before 2.11.2 had their signatures backfilled
by a manual run of the same workflow, so their identity ends in
`sbom.yml@refs/heads/main` instead of the tag. From 2.11.2 onward, expect the
tag form.

## Reporting a vulnerability

Do not open a public issue for security problems.

Report vulnerabilities privately through GitHub's
[Report a vulnerability](https://github.com/Krister-Johansson/gqlPrune/security/advisories/new)
form (repository Security → Advisories). This opens a private channel with the
maintainer.

What to expect:

- An acknowledgement within 5 business days.
- If confirmed, a fix and a coordinated-disclosure timeline. Credit is given in
  the advisory unless you prefer to remain anonymous.

## Scope

`gqlprune` is a local/CI command-line tool. It reads a `gqlPrune.config.yaml`,
parses `.gql`/`.graphql` files, and scans source files for usage. It does not
execute project code and handles no credentials. Its only network activity is a
once-a-day version check against the npm registry, which you can disable with
`NO_UPDATE_NOTIFIER=1` and which is skipped in CI.

The most relevant reports concern parsing of untrusted input (the YAML config or
GraphQL documents) or path handling that escapes the configured directories. The
published package ships only `dist/`. Report issues in dependencies (graphql,
the `@inquirer` packages, js-yaml) to their respective projects.

How the project handles findings from dependency and static analysis scanners,
including remediation thresholds and the exploitability (VEX) assessments, is
documented in [docs/security-policies.md](./docs/security-policies.md).
