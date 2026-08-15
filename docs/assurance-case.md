# Security assurance case

This page explains why we believe gqlPrune is safe to run on your code. It
states the threat model, walks the trust boundaries, and points at the controls
behind each claim. Report anything that contradicts it through
[SECURITY.md](../SECURITY.md).

## What gqlPrune is, from a security point of view

gqlPrune is a developer tool that runs locally or in CI with the invoking
user's permissions. It reads files, searches text, and prints a report. It has
no server component, no accounts, no credentials, and no persistent state
beyond a small cache file for the update check.

## Threat model

The realistic threats for a tool like this are:

1. **Malicious or malformed scanned input.** A hostile repository could contain
   a crafted `gqlPrune.config.yaml`, a crafted `.graphql` file, or an unusual
   directory layout (deep nesting, symlink loops), aiming to make the tool
   execute code, read files outside the project, or hang.
2. **Compromise of the package itself.** An attacker who could publish a
   tampered `gqlprune` release would run code on every machine that installs
   it.
3. **Compromise through dependencies.** The same, one level down.
4. **Misleading output.** A wrong "nothing unused" answer could cause a user to
   keep dead code or, worse, delete live code based on a wrong "unused" answer.

Denial of service is a minor concern: the tool is run interactively or in CI,
and a hung scan is an annoyance, not a breach.

## Argument, threat by threat

### 1. Scanned input cannot run code

- The tool never executes, imports, or evaluates anything it scans. Source
  files are read as text and searched for substrings; that is the whole
  detection mechanism.
- The config is parsed with js-yaml's `load`, which since js-yaml 4 is the safe
  loader: it instantiates no custom types and calls no functions. The parsed
  object is then validated before use, and an invalid config stops the run
  with exit code 2.
- GraphQL files are parsed with the reference `graphql` implementation. A file
  that fails to parse produces an error, not code execution.
- The directory walker only descends into the configured directories, always
  skips `node_modules` and `.git`, and resolves real paths so symlink cycles
  terminate instead of looping.
- Input validation at the boundary is tested: unknown flags, missing values,
  absent directories, and unreadable configs each have specs asserting the
  run stops with exit code 2.

### 2. A published release is what the repository built

- Releases are published to npm from GitHub Actions through OIDC trusted
  publishing with provenance. There is no long-lived npm token to steal, and
  every published version carries a Sigstore attestation linking it to the
  exact repository, commit, and workflow run that built it.
- `main` is protected: changes arrive by pull request, required CI must pass,
  and force pushes are blocked. Versioning and tagging are automated with
  release-please rather than done by hand on a laptop.
- The published package contains only `dist/`, the compiled output of the
  repository's TypeScript.

### 3. The dependency surface is small and watched

- There are six runtime dependencies, pinned through `package-lock.json`.
  The interactive prompts deliberately use the two scoped `@inquirer` packages
  instead of the full inquirer distribution to keep the transitive tree small.
- Dependabot, CodeQL, OpenSSF Scorecard, and Socket all run against the
  repository, and dependency updates land through the same reviewed-PR process
  as code.
- The update check calls Node's built-in `fetch` against
  `https://registry.npmjs.org` with a timeout; the response is only compared
  against the current version string. The check is skipped in CI and can be
  disabled with `NO_UPDATE_NOTIFIER=1`. A failed or slow check is ignored and
  never affects results or exit codes.

### 4. Output errs toward honesty

- Findings are candidates, not proof, and the documentation says so: string
  matching can produce false positives, so the tool reports and never deletes.
  The user stays in the loop for any destructive action.
- The known systematic failure (a generated file referencing every operation,
  masking all results) is detected, warned about on stderr, and surfaced in
  the JSON report's `warnings` array. `gqlprune init` pre-fills the exclusion.
- Exit codes separate findings (1) from tool failure (2), so CI cannot mistake
  a broken run for a clean one.

## Secure development practices behind the claims

TypeScript `strict` mode, ESLint, and a Jest suite with enforced coverage
thresholds (at least 90% of statements) run on every pull request on Node 20
and 22. Changes get an automated review plus the maintainer's review before
merge. The full workflow is in [CONTRIBUTING.md](../CONTRIBUTING.md) and
[GOVERNANCE.md](../GOVERNANCE.md).

## Known limitations

- gqlPrune inherits the permissions of whoever runs it. It does not sandbox
  itself; do not run it as a privileged user on untrusted input you would not
  open in an editor.
- Detection is textual. Operations referenced through dynamically built names
  or from another repository will be reported as unused; that is inherent to
  the schema-free approach and is why output is framed as candidates.
