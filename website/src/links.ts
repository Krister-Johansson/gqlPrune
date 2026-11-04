// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

const REPO = 'https://github.com/Krister-Johansson/gqlPrune';

/** Every outbound URL on the page, in one place. */
export const LINKS = {
  // The user docs, hosted on Docs7 and built from docs/ on the docs-live
  // branch. Moves to the custom domain once it is set up.
  docs: 'https://krister-johansson-gqlprune.docs7.io',
  github: REPO,
  npm: 'https://www.npmjs.com/package/gqlprune',
  changelog: `${REPO}/blob/main/CHANGELOG.md`,
  security: `${REPO}/blob/main/SECURITY.md`,
  verify: `${REPO}#verifying-a-release`,
  license: `${REPO}/blob/main/LICENSE`,
} as const;

export const COMMAND = 'npx gqlprune';
