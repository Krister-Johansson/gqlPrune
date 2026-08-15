// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import {
  COMMANDS,
  FLAGS,
  SHELLS,
  formatHelp,
  parseArgs,
} from '../src/utils/args';

describe('parseArgs', () => {
  it('defaults to no command, all flags false, empty config', () => {
    expect(parseArgs([])).toEqual({
      command: undefined,
      json: false,
      annotate: false,
      version: false,
      verbose: false,
      help: false,
      errors: [],
      config: {},
    });
  });

  it('parses the init command', () => {
    expect(parseArgs(['init'])).toEqual({
      command: 'init',
      json: false,
      annotate: false,
      version: false,
      verbose: false,
      help: false,
      errors: [],
      config: {},
    });
  });

  it('parses the --json flag', () => {
    expect(parseArgs(['--json'])).toEqual({
      command: undefined,
      json: true,
      annotate: false,
      version: false,
      verbose: false,
      help: false,
      errors: [],
      config: {},
    });
  });

  it('parses the --annotate flag', () => {
    expect(parseArgs(['--annotate'])).toEqual({
      command: undefined,
      json: false,
      annotate: true,
      version: false,
      verbose: false,
      help: false,
      errors: [],
      config: {},
    });
  });

  it('parses the --verbose flag', () => {
    expect(parseArgs(['--verbose'])).toEqual({
      command: undefined,
      json: false,
      annotate: false,
      version: false,
      verbose: true,
      help: false,
      errors: [],
      config: {},
    });
  });

  it('parses --fields into the config as checkFields', () => {
    expect(parseArgs(['--fields'])).toEqual({
      command: undefined,
      json: false,
      annotate: false,
      version: false,
      verbose: false,
      help: false,
      errors: [],
      config: { checkFields: true },
    });
  });

  it('leaves checkFields unset when --fields is absent', () => {
    expect(parseArgs(['--json']).config).toEqual({});
  });

  it('combines --fields with other flags', () => {
    const result = parseArgs(['--fields', '--json', '--src', './src']);
    expect(result.config.checkFields).toBe(true);
    expect(result.json).toBe(true);
    expect(result.config.srcDir).toBe('./src');
  });

  it('combines --verbose with other flags', () => {
    const result = parseArgs(['--verbose', '--json']);
    expect(result.verbose).toBe(true);
    expect(result.json).toBe(true);
  });

  it('parses --version and the -v short flag', () => {
    expect(parseArgs(['--version']).version).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs([]).version).toBe(false);
  });

  it('parses a command together with flags in any order', () => {
    expect(parseArgs(['--json', 'init', '--annotate'])).toEqual({
      command: 'init',
      json: true,
      annotate: true,
      version: false,
      verbose: false,
      help: false,
      errors: [],
      config: {},
    });
  });

  it('parses --graphql and --src as config paths', () => {
    expect(
      parseArgs(['--graphql', './graphql', '--src', './src']).config,
    ).toEqual({ graphqlDir: './graphql', srcDir: './src' });
  });

  it('does not mistake a flag value for the command', () => {
    // './graphql' is the value of --graphql, not a positional command.
    expect(parseArgs(['--graphql', './graphql']).command).toBeUndefined();
  });

  it('supports the --flag=value form', () => {
    expect(parseArgs(['--graphql=./g', '--src=./s']).config).toEqual({
      graphqlDir: './g',
      srcDir: './s',
    });
  });

  it('collects repeatable --ignore into excludedFolders', () => {
    expect(
      parseArgs(['--ignore', '__generated__', '--ignore', 'dist']).config,
    ).toEqual({ excludedFolders: ['__generated__', 'dist'] });
  });

  it('collects repeatable --pattern and --fragment-pattern', () => {
    expect(
      parseArgs([
        '--pattern',
        'use{Name}{Type}',
        '--fragment-pattern',
        '{Name}FragmentDoc',
      ]).config,
    ).toEqual({
      usagePatterns: ['use{Name}{Type}'],
      fragmentUsagePatterns: ['{Name}FragmentDoc'],
    });
  });

  it('combines a command, boolean flags and config flags', () => {
    expect(
      parseArgs([
        '--json',
        '--graphql',
        './g',
        '--src',
        './s',
        '--ignore',
        'x',
      ]),
    ).toEqual({
      command: undefined,
      json: true,
      annotate: false,
      version: false,
      verbose: false,
      help: false,
      errors: [],
      config: { graphqlDir: './g', srcDir: './s', excludedFolders: ['x'] },
    });
  });

  it('reports a missing value when the next token is another flag', () => {
    const result = parseArgs(['--graphql', '--json']);
    expect(result.config).toEqual({});
    expect(result.errors).toEqual(['Missing value for --graphql']);
    expect(result.json).toBe(true);
  });

  it('reports a missing value at the end of the arguments', () => {
    expect(parseArgs(['--src']).errors).toEqual(['Missing value for --src']);
  });

  it('reports an empty inline value as missing', () => {
    expect(parseArgs(['--graphql=']).errors).toEqual([
      'Missing value for --graphql',
    ]);
  });

  it('parses --help and the -h short flag', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs([]).help).toBe(false);
  });

  it('reports an unknown flag as an error', () => {
    expect(parseArgs(['--jsn']).errors).toEqual(['Unknown flag: --jsn']);
  });

  it('reports an unknown flag given in --flag=value form', () => {
    expect(parseArgs(['--foo=bar']).errors).toEqual(['Unknown flag: --foo']);
  });

  it('reports an unknown short flag as an error', () => {
    expect(parseArgs(['-x']).errors).toEqual(['Unknown flag: -x']);
  });

  it('reports an unexpected second positional argument', () => {
    const result = parseArgs(['init', 'extra']);
    expect(result.command).toBe('init');
    expect(result.errors).toEqual(['Unexpected argument: extra']);
  });

  it('collects repeated --graphql and --src into arrays', () => {
    expect(
      parseArgs([
        '--graphql',
        './g1',
        '--graphql',
        './g2',
        '--src',
        './s1',
        '--src',
        './s2',
      ]).config,
    ).toEqual({ graphqlDir: ['./g1', './g2'], srcDir: ['./s1', './s2'] });
  });

  it('keeps a single --graphql / --src value as a string', () => {
    expect(parseArgs(['--graphql', './g', '--src', './s']).config).toEqual({
      graphqlDir: './g',
      srcDir: './s',
    });
  });

  it('parses --schema as the config schemaFile', () => {
    expect(parseArgs(['--schema', './schema.graphql']).config).toEqual({
      schemaFile: './schema.graphql',
    });
    expect(parseArgs(['--schema=./schema.graphql']).config).toEqual({
      schemaFile: './schema.graphql',
    });
  });

  it('keeps the last --schema when it is given twice', () => {
    expect(
      parseArgs(['--schema', './a.graphql', '--schema', './b.graphql']).config,
    ).toEqual({
      schemaFile: './b.graphql',
    });
  });

  it('reports a missing value for --schema', () => {
    const result = parseArgs(['--schema']);
    expect(result.config).toEqual({});
    expect(result.errors).toEqual(['Missing value for --schema']);
  });

  it('collects repeatable --exclude into config.exclude', () => {
    expect(
      parseArgs([
        '--exclude',
        '**/*.generated.ts',
        '--exclude',
        '__generated__',
      ]).config,
    ).toEqual({ exclude: ['**/*.generated.ts', '__generated__'] });
  });

  it('parses the completion command with its shell argument', () => {
    expect(parseArgs(['completion', 'zsh'])).toEqual({
      command: 'completion',
      commandArg: 'zsh',
      json: false,
      annotate: false,
      version: false,
      verbose: false,
      help: false,
      errors: [],
      config: {},
    });
  });

  it('leaves commandArg undefined when completion gets no shell', () => {
    const result = parseArgs(['completion']);
    expect(result.command).toBe('completion');
    expect(result.commandArg).toBeUndefined();
    expect(result.errors).toEqual([]);
  });

  it('keeps an unknown shell as commandArg for the caller to reject', () => {
    // parseArgs reports usage shape only; cli.ts decides which shells exist.
    expect(parseArgs(['completion', 'ksh']).commandArg).toBe('ksh');
  });

  it('parses flags given after the completion command', () => {
    const result = parseArgs(['completion', 'bash', '--json']);
    expect(result.command).toBe('completion');
    expect(result.commandArg).toBe('bash');
    expect(result.json).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports a third positional after the completion shell', () => {
    const result = parseArgs(['completion', 'bash', 'extra']);
    expect(result.commandArg).toBe('bash');
    expect(result.errors).toEqual(['Unexpected argument: extra']);
  });

  it('does not give init a command argument', () => {
    expect(parseArgs(['init', 'extra']).commandArg).toBeUndefined();
  });

  it('accepts every flag and alias in the FLAGS table', () => {
    for (const spec of FLAGS) {
      const argv = spec.takesValue ? [spec.flag, 'x'] : [spec.flag];
      expect(parseArgs(argv).errors).toEqual([]);
      if (spec.alias !== undefined) {
        expect(parseArgs([spec.alias]).errors).toEqual([]);
      }
    }
  });
});

describe('CLI metadata tables', () => {
  it('lists init and completion as the commands', () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(['init', 'completion']);
  });

  it('gives the completion command the supported shells as its argument', () => {
    const completion = COMMANDS.find((c) => c.name === 'completion');
    expect(completion?.argValues).toEqual([...SHELLS]);
  });

  it('supports bash, zsh and fish', () => {
    expect([...SHELLS]).toEqual(['bash', 'zsh', 'fish']);
  });

  it('gives every value flag a placeholder and every boolean flag none', () => {
    for (const spec of FLAGS) {
      if (spec.takesValue) {
        expect(spec.valuePlaceholder).toMatch(/^<.+>$/);
      } else {
        expect(spec.valuePlaceholder).toBeUndefined();
      }
    }
  });

  it('marks the directory and schema flags as path-valued', () => {
    expect(
      FLAGS.filter((f) => f.valueKind === 'path').map((f) => f.flag),
    ).toEqual(['--graphql', '--src', '--schema']);
  });

  it('gives every boolean flag exactly one destination', () => {
    // A switch writes either a CliOptions field or a CliConfig one, never both
    // and never neither, or passing it would silently do nothing.
    for (const spec of FLAGS) {
      if (spec.takesValue) continue;
      const destinations = [spec.option, spec.configFlag].filter(
        (value) => value !== undefined,
      );
      expect(destinations).toHaveLength(1);
    }
  });

  it('routes --fields into the config rather than the CLI options', () => {
    const fields = FLAGS.find((f) => f.flag === '--fields');
    expect(fields?.takesValue).toBe(false);
    expect(fields?.configFlag).toBe('checkFields');
    expect(fields?.option).toBeUndefined();
  });
});

describe('formatHelp', () => {
  it('documents the command and every flag', () => {
    const help = formatHelp();
    expect(help).toContain('init');
    for (const flag of [
      '--graphql',
      '--src',
      '--exclude',
      '--ignore',
      '--pattern',
      '--fragment-pattern',
      '--schema',
      '--fields',
      '--json',
      '--annotate',
      '--verbose',
      '--version',
      '--help',
    ]) {
      expect(help).toContain(flag);
    }
  });

  it('documents every flag in the FLAGS table', () => {
    const help = formatHelp();
    for (const spec of FLAGS) {
      expect(help).toContain(spec.flag);
      expect(help).toContain(spec.description);
      if (spec.alias !== undefined) expect(help).toContain(spec.alias);
    }
  });

  it('documents every command in the COMMANDS table', () => {
    const help = formatHelp();
    for (const spec of COMMANDS) {
      expect(help).toContain(spec.name);
      expect(help).toContain(spec.description);
    }
  });

  it('starts every command and flag description in the same column', () => {
    const lines = formatHelp().split('\n');
    for (const spec of [...COMMANDS, ...FLAGS]) {
      const line = lines.find((l) => l.endsWith(spec.description));
      expect(line?.indexOf(spec.description)).toBe(28);
    }
  });

  it('marks --ignore as deprecated in favor of --exclude', () => {
    const line = formatHelp()
      .split('\n')
      .find((l) => l.includes('--ignore'));
    expect(line).toMatch(/deprecated/i);
  });
});
