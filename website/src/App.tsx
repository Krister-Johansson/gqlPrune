// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// Placeholder landing page. The text is copied from the root package.json on
// purpose: the site builds on its own and never reads from the package.
const DESCRIPTION =
  'Finds unused GraphQL operations and fragments by scanning .gql/.graphql files and parsing your TypeScript/JavaScript source to check whether each one is referenced, following imports and re-exports. No schema or running server needed.';

const INSTALL_COMMAND = 'npx gqlprune';

const LINKS = [
  { label: 'GitHub', href: 'https://github.com/Krister-Johansson/gqlPrune' },
  { label: 'npm', href: 'https://www.npmjs.com/package/gqlprune' },
];

/** The landing page: name, one-line description, install command, links. */
export function App() {
  return (
    <main className="page">
      <h1>gqlPrune</h1>
      <p className="description">{DESCRIPTION}</p>
      <pre className="command">
        <code>{INSTALL_COMMAND}</code>
      </pre>
      <nav className="links" aria-label="Project links">
        {LINKS.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
    </main>
  );
}
