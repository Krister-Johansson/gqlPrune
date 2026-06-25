import fs from 'fs';
import os from 'os';
import path from 'path';
import kleur from 'kleur';

const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const FETCH_TIMEOUT_MS = 3000;
const CACHE_FILE = path.join(os.tmpdir(), 'gqlprune-update-check.json');

type Cache = { lastCheck: number; latest: string };

/**
 * Whether `latest` is a newer release than `current`, comparing only the
 * `major.minor.patch` core (ignoring any pre-release/build suffix). Returns
 * false if either version can't be parsed.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): [number, number, number] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return match
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : undefined;
  };
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Reads the cached check, or undefined when missing/unreadable. */
function readCache(): Cache | undefined {
  try {
    const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Cache;
    return typeof cache.lastCheck === 'number' &&
      typeof cache.latest === 'string'
      ? cache
      : undefined;
  } catch {
    return undefined;
  }
}

/** Persists the latest-version check; failures are ignored. */
function writeCache(cache: Cache): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    // A non-writable temp dir must not break the run.
  }
}

/** Fetches the latest published version from the npm registry (times out). */
async function fetchLatestVersion(name: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://registry.npmjs.org/${name}/latest`, {
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { version?: string };
    return data.version;
  } finally {
    clearTimeout(timer);
  }
}

/** The latest version, from the daily cache or a fresh registry fetch. */
async function getLatestVersion(name: string): Promise<string | undefined> {
  const cache = readCache();
  if (cache && Date.now() - cache.lastCheck < ONE_DAY_MS) {
    return cache.latest;
  }
  const latest = await fetchLatestVersion(name);
  if (latest) {
    writeCache({ lastCheck: Date.now(), latest });
  }
  return latest;
}

/**
 * Checks npm (cached ~daily) and prints a one-line notice to **stderr** when a
 * newer version is available. Stays silent in CI, in `--json` mode, when
 * `NO_UPDATE_NOTIFIER` is set, and when stdout isn't a TTY — so machine-readable
 * output and CI gating stay clean. Network/cache errors are swallowed, and it
 * never touches stdout or the process exit code.
 */
export async function notifyUpdate(
  pkg: { name: string; version: string },
  options: { json?: boolean } = {},
): Promise<void> {
  if (
    options.json ||
    process.env.CI ||
    process.env.NO_UPDATE_NOTIFIER ||
    !process.stdout.isTTY
  ) {
    return;
  }

  try {
    const latest = await getLatestVersion(pkg.name);
    if (latest && isNewerVersion(latest, pkg.version)) {
      console.error(
        kleur.yellow(
          `Update available for ${pkg.name}: ${pkg.version} → ${latest}. ` +
            `Run \`npm i -D ${pkg.name}@latest\` to update.`,
        ),
      );
    }
  } catch {
    // An update check must never break or slow down the actual command.
  }
}
