// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

const REPO = 'https://github.com/Krister-Johansson/gqlPrune';

/** Every outbound URL on the page, in one place. */
export const LINKS = {
  // The docs site on Docs7 does not exist yet; the README is the reference
  // until it does.
  docs: `${REPO}#readme`,
  github: REPO,
  npm: 'https://www.npmjs.com/package/gqlprune',
  changelog: `${REPO}/blob/main/CHANGELOG.md`,
  security: `${REPO}/blob/main/SECURITY.md`,
  verify: `${REPO}#verifying-a-release`,
  license: `${REPO}/blob/main/LICENSE`,
} as const;

export const COMMAND = 'npx gqlprune';
