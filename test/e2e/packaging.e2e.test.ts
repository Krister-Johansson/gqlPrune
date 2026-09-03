// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// The slowest case in the suite and the one that pays for itself: it packs the
// package the way `npm publish` would, installs the tarball into a throwaway
// directory, and runs the *installed* `gqlprune` binary. A broken `bin`
// mapping, a file missing from `files`, or a lost shebang all survive every
// other test in this repository and fail here.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fixtureRoot, repoRoot, runProcess, toPosix } from './helpers';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const pkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
) as { name: string; version: string };

/** Runs npm synchronously and returns its stdout. */
function npmSync(args: string[], cwd: string): string {
  return execFileSync(npm, args, {
    cwd,
    encoding: 'utf8',
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });
}

let workDir: string;
let installDir: string;
let binPath: string;

// Packing and installing dominate the runtime; the default 5s timeout is far
// too short for them.
jest.setTimeout(300_000);

/** One packed package as `npm pack --json` describes it. */
type PackEntry = { filename: string; files: { path: string }[] };

/**
 * Reads the entries out of `npm pack --json`. npm 10 prints them as an array;
 * npm 11 and later key them by package name. Accepting both keeps the spec
 * runnable on a developer's npm as well as on the runner's.
 */
function packEntries(json: string): PackEntry[] {
  const parsed = JSON.parse(json) as PackEntry[] | Record<string, PackEntry>;
  return Array.isArray(parsed) ? parsed : Object.values(parsed);
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gqlprune-pack-'));
  installDir = path.join(workDir, 'consumer');
  fs.mkdirSync(installDir);
  // A bare consumer package, so npm installs into installDir/node_modules
  // instead of walking up and finding this repository.
  fs.writeFileSync(
    path.join(installDir, 'package.json'),
    JSON.stringify({
      name: 'gqlprune-e2e-consumer',
      version: '1.0.0',
      private: true,
    }),
  );

  const [packed] = packEntries(
    npmSync(['pack', '--json', '--pack-destination', workDir], repoRoot),
  );
  const tarball = path.join(workDir, packed.filename);

  npmSync(
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--prefer-offline',
      tarball,
    ],
    installDir,
  );

  binPath = path.join(
    installDir,
    'node_modules',
    '.bin',
    isWindows ? 'gqlprune.cmd' : 'gqlprune',
  );
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

/** Runs the installed binary, exercising the bin mapping and the shebang. */
function runInstalled(args: string[]) {
  return runProcess(binPath, args, {
    cwd: fixtureRoot,
    shell: isWindows,
  });
}

describe('packEntries', () => {
  const entry = { filename: 'gqlprune-0.0.0.tgz', files: [] };

  it('reads the array npm 10 prints', () => {
    expect(packEntries(JSON.stringify([entry]))).toEqual([entry]);
  });

  it('reads the object keyed by package name that npm 11 and later print', () => {
    expect(packEntries(JSON.stringify({ gqlprune: entry }))).toEqual([entry]);
  });
});

describe('the published tarball', () => {
  it('ships dist and no test fixtures', () => {
    const [dryRun] = packEntries(
      npmSync(['pack', '--dry-run', '--json'], repoRoot),
    );
    const files = dryRun.files.map((file) => toPosix(file.path));

    expect(files).toContain('dist/cli.js');
    expect(files.filter((file) => file.startsWith('test/'))).toEqual([]);
  });

  it('installs a working gqlprune binary', async () => {
    const result = await runInstalled(['--version']);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('scans a clean project and exits 0', async () => {
    const result = await runInstalled([
      '--graphql',
      'clean/graphql',
      '--src',
      'clean/src',
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'No unused GraphQL operations or fragments found.',
    );
  });

  it('reports findings and exits 1', async () => {
    const result = await runInstalled([
      '--graphql',
      'app/graphql',
      '--src',
      'app/src',
      '--json',
    ]);
    const report = JSON.parse(result.stdout) as {
      unusedOperations: { name: string }[];
    };

    expect(result.code).toBe(1);
    expect(report.unusedOperations.map((op) => op.name)).toEqual([
      'GetLegacyReport',
    ]);
  });
});
