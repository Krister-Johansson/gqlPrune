# Security analysis policies

This page says how the project handles findings from the scanners that watch
the codebase, and what has to be true before a release ships. The scanners
themselves are listed in the [assurance case](./assurance-case.md).

## Dependency analysis (SCA)

Dependabot scans the dependency tree continuously and opens alerts and update
pull requests. Socket and the OpenSSF Scorecard provide outside views of the
same surface. On top of that, every pull request runs a dependency audit check
(`npm audit` against the production tree) that fails on high or critical
advisories, so a change cannot merge while it introduces a known-vulnerable
dependency unless the finding is formally dismissed first.

Remediation thresholds, counted from when an alert appears:

| Severity | Target                                                                       |
| -------- | ---------------------------------------------------------------------------- |
| Critical | Fix or dismiss with justification within 7 days, and before the next release |
| High     | Within 14 days, and before the next release                                  |
| Moderate | Within 30 days                                                               |
| Low      | Best effort, reviewed at the next release                                    |

A release does not ship while a critical or high dependency finding is open
against the production tree. Dev-only findings do not block a release but
follow the same timelines.

License policy: runtime dependencies must carry OSI-approved permissive
licenses compatible with MIT. The full license inventory is generated into
[NOTICES.md](../NOTICES.md); a dependency that changes to an incompatible
license is treated as a critical finding and replaced.

## Secrets and credentials

The project is designed to hold as few secrets as possible:

- Publishing needs no stored credential. npm releases use OIDC trusted
  publishing from GitHub Actions, so there is no npm token to store, leak, or
  rotate.
- The only standing secret is the Codecov upload token, kept as a GitHub
  Actions repository secret. It can only upload coverage reports; it grants no
  access to code, accounts, or publishing.
- Secrets are never hard-coded or committed. GitHub secret scanning runs on
  the repository, and local artifacts are gitignored.
- Access to repository secrets requires admin access to the repository, which
  is governed by the escalated-permissions policy in
  [GOVERNANCE.md](../GOVERNANCE.md).
- Rotation: the Codecov token is rotated from the Codecov dashboard whenever
  exposure is suspected and whenever repository access changes. A secret that
  gains broader scope than described here must be documented in this section
  first.

## Exploitability assessments (VEX)

When a scanner reports a vulnerability in a component that does not actually
affect gqlPrune (for example, code that is never reached, or a dev-only
dependency), the assessment is recorded instead of silently dismissed. Each
such finding gets a statement here with the advisory ID, the affected
component, the verdict, and the reasoning, and the corresponding alert is
dismissed with the same justification so the two records match.

Current statements: none. There are no open component vulnerabilities assessed
as not affecting the project (last reviewed 2026-08-15). Historical example of
the process: the dev-only transitive `js-yaml` 3.x advisories were assessed as
test-scope only, then removed entirely by upgrading the transitive dependency
in [#101](https://github.com/Krister-Johansson/gqlPrune/pull/101).

## Static analysis (SAST)

CodeQL scans every pull request and push to `main` (GitHub code scanning,
default setup, javascript-typescript plus actions). ESLint and TypeScript
`strict` mode run in the required CI checks and fail the build on any error.

Remediation thresholds for code scanning alerts:

| Severity         | Target                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Critical or high | Fix before merge when introduced by the change; otherwise within 14 days and before the next release |
| Medium           | Within 30 days                                                                                       |
| Low              | Best effort, reviewed at the next release                                                            |

An alert is only ever closed by fixing it or by dismissing it with a written
justification on the alert itself. Dismissals without reasoning are not
acceptable.
