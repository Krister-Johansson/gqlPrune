#!/usr/bin/env node
// Synthetic-tree benchmark for the scan engine (ADR 0001 asks for a before and
// after timing on a large tree, recorded in issue #142).
//
// It generates a deterministic project under a temp directory: feature folders
// with a hooks.ts that re-exports codegen hooks from a generated/ directory that
// does not exist (the way an excluded codegen output looks to the scan), a
// barrel index.ts per feature, and page components that import three to five
// hooks through the barrels and call them. Half of the operations are never
// referenced. The same tree is reused across runs, so every engine scans the
// same bytes; both should report the same unusedOperations count.
//
//   node scripts/benchmark.mjs --cli dist/cli.js --files 2000 --operations 1000
//
// Options: --cli <path> (required), --files N (default 2000), --operations M
// (default 1000), --runs R (default 3, after one warm-up), --out <dir>.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const args = parseArgs(process.argv.slice(2));
if (!args.cli) {
  console.error(
    'usage: benchmark.mjs --cli <path-to-cli.js> [--files N] [--operations M] [--runs R] [--out dir]',
  );
  process.exit(2);
}
const files = Number(args.files ?? 2000);
const operations = Number(args.operations ?? 1000);
const runs = Number(args.runs ?? 3);
const out = path.resolve(
  args.out ?? path.join(tmpdir(), `gqlprune-bench-${files}-${operations}`),
);
const cli = path.resolve(args.cli);

if (!existsSync(path.join(out, 'graphql'))) {
  generateTree(out, files, operations);
}

const times = [];
let unused;
for (let run = 0; run <= runs; run += 1) {
  const started = performance.now();
  const report = scan(cli, out);
  const elapsed = performance.now() - started;
  if (run > 0) times.push(elapsed);
  unused = report.summary.unusedOperations;
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
console.log(
  [
    `files=${files}`,
    `operations=${operations}`,
    `runs=${times.map((t) => t.toFixed(0)).join('/')}ms`,
    `median=${median.toFixed(0)}ms`,
    `unusedOperations=${unused}`,
    `tree=${out}`,
  ].join(' '),
);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      parsed[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}

function scan(cliPath, cwd) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [cliPath, '--graphql', 'graphql', '--src', 'src', '--json'],
      {
        cwd,
        env: { ...process.env, NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 256 * 1024 * 1024,
      },
    );
    return JSON.parse(stdout);
  } catch (error) {
    // Exit code 1 means findings, which the dead half guarantees.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

// A small deterministic generator so the tree is the same on every machine.
function lcg(seed) {
  let state = seed >>> 0;
  return (bound) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % bound;
  };
}

function generateTree(root, fileCount, operationCount) {
  const random = lcg(142);
  const usedCount = Math.floor(operationCount / 2);
  const featureCount = Math.max(1, Math.floor(fileCount / 4));
  const pageCount = Math.max(1, fileCount - featureCount * 2);

  mkdirSync(path.join(root, 'graphql'), { recursive: true });
  const perFile = 20;
  for (let start = 0; start < operationCount; start += perFile) {
    const body = [];
    for (let k = start; k < Math.min(start + perFile, operationCount); k += 1) {
      body.push(
        `query BenchOp${k} {\n  item${k}(id: 1) {\n    id\n    name\n  }\n}\n`,
      );
    }
    writeFileSync(
      path.join(root, 'graphql', `ops-${start / perFile}.gql`),
      body.join('\n'),
    );
  }

  // The first half of the operations is alive, spread over the features.
  const hooksByFeature = Array.from({ length: featureCount }, () => []);
  for (let k = 0; k < usedCount; k += 1) {
    hooksByFeature[k % featureCount].push(`useBenchOp${k}Query`);
  }
  hooksByFeature.forEach((hooks, i) => {
    const dir = path.join(root, 'src', 'features', `f${i}`);
    mkdirSync(dir, { recursive: true });
    const lines = hooks.map(
      (hook) => `export { ${hook} } from '../../generated/graphql';`,
    );
    if (lines.length === 0) lines.push('export {};');
    writeFileSync(path.join(dir, 'hooks.ts'), `${lines.join('\n')}\n`);
    writeFileSync(path.join(dir, 'index.ts'), `export * from './hooks';\n`);
  });

  // Every live hook is imported by at least one page; pages then pick more at random.
  const pagesDir = path.join(root, 'src', 'pages');
  mkdirSync(pagesDir, { recursive: true });
  const allHooks = hooksByFeature.flatMap((hooks, feature) =>
    hooks.map((hook) => ({ hook, feature })),
  );
  for (let p = 0; p < pageCount; p += 1) {
    const picked = new Map();
    if (allHooks.length > 0) {
      for (let k = p; k < allHooks.length; k += pageCount)
        picked.set(allHooks[k].hook, allHooks[k].feature);
      const extra = 3 + random(3);
      while (picked.size < extra && picked.size < allHooks.length) {
        const choice = allHooks[random(allHooks.length)];
        picked.set(choice.hook, choice.feature);
      }
    }
    writeFileSync(path.join(pagesDir, `P${p}.tsx`), pageSource(p, picked));
  }
}

function pageSource(index, picked) {
  const imports = [];
  const byFeature = new Map();
  for (const [hook, feature] of picked) {
    if (!byFeature.has(feature)) byFeature.set(feature, []);
    byFeature.get(feature).push(hook);
  }
  for (const [feature, hooks] of byFeature) {
    imports.push(
      `import { ${hooks.join(', ')} } from '../features/f${feature}';`,
    );
  }
  const calls = [...picked.keys()].map(
    (hook, i) => `  const result${i} = ${hook}({ variables: { id: ${i} } });`,
  );
  const reads = [...picked.keys()].map(
    (_, i) => `      <li>{String(result${i}.data?.item)}</li>`,
  );
  return `// Generated benchmark page ${index}. Never compiled; only scanned.
import React from 'react';
${imports.join('\n')}

/**
 * Page ${index} renders a handful of query results. The prose here exists so
 * the parser and the regex engine both have ordinary comment text to skip.
 */
const LABELS = { title: 'Page ${index}', empty: 'Nothing loaded yet', retry: 'Try again' };

export function Page${index}() {
${calls.join('\n')}
  const state = { loading: false, error: undefined, count: ${picked.size} };
  if (state.loading) {
    return <p>{LABELS.empty}</p>;
  }
  return (
    <section>
      <h1>{LABELS.title}</h1>
      <ul>
${reads.join('\n')}
      </ul>
      <button type="button">{LABELS.retry}</button>
    </section>
  );
}

export default Page${index};
`;
}
