import { formatHelp, parseArgs } from '../src/utils/args';

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
      '--json',
      '--annotate',
      '--verbose',
      '--version',
      '--help',
    ]) {
      expect(help).toContain(flag);
    }
  });

  it('marks --ignore as deprecated in favor of --exclude', () => {
    const line = formatHelp()
      .split('\n')
      .find((l) => l.includes('--ignore'));
    expect(line).toMatch(/deprecated/i);
  });
});
