import updateNotifierImport from 'simple-update-notifier';

type UpdateNotifier = (args: {
  pkg: { name: string; version: string };
}) => Promise<void>;

// `simple-update-notifier` is CJS (`module.exports = fn`) shipped with an
// ESM-style default `.d.ts`, which `node16` resolution mistypes as a namespace
// rather than the callable. The default import IS the function at runtime (for
// both the ESM build and the test mock); re-type it so TS sees the signature.
const updateNotifier = updateNotifierImport as unknown as UpdateNotifier;

/**
 * Checks npm for a newer version of the package and prints a notice to **stderr**
 * if one is available. The check is cached (~daily) by `simple-update-notifier`,
 * which also skips automatically when stdout isn't a TTY or when run as an npm
 * script, and swallows network/cache errors so it never crashes.
 *
 * We additionally opt out in CI, when `NO_UPDATE_NOTIFIER` is set, and in
 * `--json` mode, so machine-readable output and CI gating stay clean. This never
 * touches stdout or the process exit code.
 */
export async function notifyUpdate(
  pkg: { name: string; version: string },
  options: { json?: boolean } = {},
): Promise<void> {
  if (options.json || process.env.CI || process.env.NO_UPDATE_NOTIFIER) {
    return;
  }
  await updateNotifier({ pkg });
}
