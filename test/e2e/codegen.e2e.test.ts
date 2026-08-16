// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// End-to-end cases for deriving settings from a GraphQL Code Generator config.
//
// Every scenario here runs in a working directory of its own. Both
// `gqlPrune.config.yaml` and the codegen config are looked up in the process's
// cwd, so a case run from the shared fixture root would read whichever config
// happened to sit there, and one project's settings would decide another
// project's scan.
//
// Fixtures, each a self-contained project:
//   codegen/derived/        codegen.yml and no gqlPrune config: everything is
//                           derived, including a local SDL
//   codegen/precedence/     a gqlPrune.config.yaml beside a codegen.yml that
//                           points at a decoy directory
//   codegen/angular/        typescript-apollo-angular, whose {Name}GQL
//                           convention the built-in defaults do not know
//   codegen/missing-schema/ a derived schema path that is not on disk
//   codegen/client-preset/  a codegen.ts using the client preset, which turns
//                           the inline scan on by itself
//   codegen/broken/         a codegen.json that does not parse

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertCliBuilt,
  expectJsonOnlyStdout,
  fixtureProject,
  parseReport,
  runCli,
  runCliInteractive,
  toPosix,
} from './helpers';

const derived = fixtureProject('codegen', 'derived');
const precedence = fixtureProject('codegen', 'precedence');
const angular = fixtureProject('codegen', 'angular');
const missingSchema = fixtureProject('codegen', 'missing-schema');
const clientPreset = fixtureProject('codegen', 'client-preset');

beforeAll(() => {
  assertCliBuilt();
});

describe('a project configured only by its codegen config', () => {
  it('scans it and names the file the settings came from', async () => {
    const result = await runCli([], { cwd: derived });

    expect(result.code).toBe(1);
    // An inferred configuration has to be visible, or a surprising result has
    // no explanation. The line names the file and every key it supplied.
    expect(result.stdout).toContain('Using settings derived from codegen.yml:');
    for (const key of ['graphqlDir', 'srcDir', 'exclude', 'schemaFile']) {
      expect(result.stdout).toContain(key);
    }
  });

  it('applies the derived directories, schema and patterns', async () => {
    const result = await runCli(['--json'], { cwd: derived });
    const report = parseReport(result);

    expectJsonOnlyStdout(result);
    // The documents glob became the directory to scan ...
    expect(report.unusedOperations.map((op) => op.name)).toEqual([
      'GetDerivedDeadOrder',
    ]);
    // ... and the derived usagePatterns kept the other operation off the list.
    // The derived schema is what produced this advisory section at all.
    expect(report.deprecatedUsages.map((usage) => usage.message)).toEqual([
      'The field Order.legacyStatus is deprecated. Use state instead.',
    ]);
  });

  it('still names the file in --json mode, on stderr', async () => {
    const result = await runCli(['--json'], { cwd: derived });
    const report = parseReport(result);

    // A CI job that reads only the JSON would otherwise be handed results whose
    // directories, excludes, schema and patterns all came from a file it never
    // pointed at, with nothing anywhere saying so.
    expectJsonOnlyStdout(result);
    expect(result.stderr).toContain('Using settings derived from codegen.yml:');
    for (const key of ['graphqlDir', 'srcDir', 'exclude', 'schemaFile']) {
      expect(result.stderr).toContain(key);
    }
    // It says where the settings came from, not that something is wrong with
    // the project, so it stays out of the array consumers read as problems.
    expect(report.warnings.join('\n')).not.toContain('derived from');
  });

  it('explains the derivation on stderr under --verbose', async () => {
    const result = await runCli(['--json', '--verbose'], { cwd: derived });

    expectJsonOnlyStdout(result);
    expect(result.stderr).toContain('codegen config: codegen.yml');
    expect(result.stderr).toContain('codegen graphqlDir:');
  });
});

describe('precedence', () => {
  it('lets gqlPrune.config.yaml win, leaving the codegen documents unscanned', async () => {
    const result = await runCli(['--json'], { cwd: precedence });
    const report = parseReport(result);

    expect(report.unusedOperations.map((op) => op.name)).toEqual([
      'GetRealThing',
    ]);
    // The decoy lives under the directory the codegen config names. Seeing it
    // here would mean an inferred setting overrode a configured one.
    expect(JSON.stringify(report)).not.toContain('GetDecoyThing');
  });

  it('does not announce a derivation that never happened', async () => {
    const result = await runCli([], { cwd: precedence });

    expect(result.stdout).not.toContain('Using settings derived from');
  });
});

describe('a plugin whose convention differs from the defaults', () => {
  it('reports nothing unused for an operation used the Angular way', async () => {
    const result = await runCli([], { cwd: angular });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Using settings derived from codegen.yml:');
    expect(result.stdout).toContain(
      'No unused GraphQL operations or fragments found.',
    );
  });

  it('reports it unused once the built-in defaults apply again', async () => {
    // Naming the directories configures the run, which is exactly what stops
    // the codegen config being read. Same project, same files, no {Name}GQL
    // pattern: this is the finding the derived patterns suppress.
    const result = await runCli(
      ['--graphql', './src', '--src', './src', '--json'],
      {
        cwd: angular,
      },
    );
    const report = parseReport(result);

    expect(result.code).toBe(1);
    expect(report.unusedOperations.map((op) => op.name)).toEqual(['GetThing']);
  });
});

describe('a derived schema that is not on disk', () => {
  it('warns, skips the deprecated check, and still exits on the findings', async () => {
    const result = await runCli(['--json'], { cwd: missingSchema });
    const report = parseReport(result);

    // Explicit configuration fails loudly; inference degrades gracefully. The
    // user never asked for this schema, so it costs the advisory check and
    // nothing else.
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Skipped the deprecated-selection check');
    expect(
      report.warnings.filter((warning) =>
        warning.includes('Skipped the deprecated-selection check'),
      ),
    ).toHaveLength(1);
    expect(report.deprecatedUsages).toEqual([]);
    expect(report.unusedOperations.map((op) => op.name)).toEqual([
      'GetLostReport',
    ]);
  });

  it('exits 2 when the same path is asked for with --schema', async () => {
    const result = await runCli(['--schema', './schema-from-build.graphql'], {
      cwd: missingSchema,
    });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      'Could not read or parse the GraphQL schema file',
    );
  });
});

describe('--codegen', () => {
  it('exits 2 on a file it cannot read', async () => {
    const result = await runCli([
      '--codegen',
      'codegen/nowhere.yml',
      '--graphql',
      'app/graphql',
      '--src',
      'app/src',
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Could not read codegen/nowhere.yml.');
    expect(result.stdout).toBe('');
  });

  it('exits 2 on a file it cannot parse', async () => {
    const result = await runCli([
      '--codegen',
      'codegen/broken/codegen.json',
      '--graphql',
      'app/graphql',
      '--src',
      'app/src',
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      'Could not parse codegen/broken/codegen.json',
    );
  });
});

describe('the client preset, end to end', () => {
  it('turns the inline scan on and grades what it finds', async () => {
    const result = await runCli(['--json'], { cwd: clientPreset });
    const report = parseReport(result);

    expectJsonOnlyStdout(result);
    expect(result.code).toBe(1);
    // Nothing on the command line asked for --inline: the preset did.
    expect(report.unusedOperations).toHaveLength(1);
    expect(report.unusedOperations[0]).toMatchObject({
      name: 'GetClientOrphan',
      confidence: 'high',
      reason: 'name-absent',
    });
    expect(toPosix(report.unusedOperations[0].file)).toBe('src/App.tsx');
    // The one kept alive through its constant, the way the preset intends.
    expect(JSON.stringify(report)).not.toContain('GetClientList');
  });

  it('says so in the human report', async () => {
    const result = await runCli([], { cwd: clientPreset });

    expect(result.stdout).toContain('Using settings derived from codegen.ts:');
    expect(result.stdout).toContain('inline');
    expect(result.stdout).toContain('Found 2 inline GraphQL documents.');
  });
});

describe('gqlprune init in a codegen project', () => {
  let workDir: string;

  beforeAll(() => {
    // init writes gqlPrune.config.yaml into the working directory, so it runs
    // against a copy: the fixture tree stays as committed.
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gqlprune-init-'));
    fs.cpSync(angular, workDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('writes the settings it announces', async () => {
    // Three prompts, each answered with the default: the GraphQL directory, the
    // source directory, and the exclude list.
    const result = await runCliInteractive(['init'], {
      cwd: workDir,
      answers: ['', '', ''],
    });
    const written = fs.readFileSync(
      path.join(workDir, 'gqlPrune.config.yaml'),
      'utf8',
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'Found codegen.yml; these settings come from it',
    );
    expect(result.stdout).toContain('usagePatterns');
    // Writing a config is what stops gqlPrune reading the codegen config on
    // later runs, so a derived setting left out of the file is not merely
    // unannounced, it is lost.
    expect(written).toContain('{Name}GQL');
    expect(written).toContain('{Name}FragmentDoc');
    expect(written).toContain('graphqlDir');
    expect(written).toContain('srcDir');
  });
});
