import { createRequire } from 'node:module';

/**
 * gqlPrune's own `package.json`, read at runtime relative to this ESM module
 * (via `createRequire`) so it resolves to the installed package — not the user's
 * cwd. Isolated here because `import.meta` is ESM-only; tests mock this module.
 */
const require = createRequire(import.meta.url);
export const pkg = require('../../package.json') as {
  name: string;
  version: string;
};
