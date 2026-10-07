// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { readFileSync } from 'node:fs';

/**
 * gqlPrune's own `package.json`, read at runtime relative to this ESM module
 * (a URL off `import.meta.url`) so it resolves to the installed package, not
 * the user's cwd. A plain file read, not `createRequire`, keeps the published
 * code free of module-loader APIs. Isolated here because `import.meta` is
 * ESM-only; tests mock this module.
 */
export const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as {
  name: string;
  version: string;
  homepage: string;
};
