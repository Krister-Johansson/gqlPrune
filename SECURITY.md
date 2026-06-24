# Security Policy

## Supported versions

`gqlprune` follows semantic versioning. Security fixes are released against the
**latest published version** — please upgrade before reporting.

| Version        | Supported |
| -------------- | --------- |
| latest release | ✅        |
| older releases | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub's
[**Report a vulnerability**](https://github.com/Krister-Johansson/gqlPrune/security/advisories/new)
form (repository **Security → Advisories**). This opens a private channel with the
maintainer.

What to expect:

- An acknowledgement within **5 business days**.
- If confirmed, a fix and a coordinated-disclosure timeline. Credit is given in the
  advisory unless you prefer to remain anonymous.

## Scope

`gqlprune` is a local/CI command-line tool. It reads a `gqlPrune.config.yaml`,
parses `.gql`/`.graphql` files, and scans source files for usage. It does not
execute project code, make network requests, or handle credentials.

The most relevant reports concern parsing of untrusted input (the YAML config or
GraphQL documents) or path handling that escapes the configured directories. The
published package ships only `dist/` — please report issues in dependencies
(graphql, inquirer, js-yaml) to their respective projects.
