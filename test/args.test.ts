import { parseArgs } from '../src/utils/args';

describe('parseArgs', () => {
  it('defaults to no command, all flags false, empty config', () => {
    expect(parseArgs([])).toEqual({
      command: undefined,
      json: false,
      annotate: false,
      version: false,
      verbose: false,
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
      config: { graphqlDir: './g', srcDir: './s', excludedFolders: ['x'] },
    });
  });

  it('ignores a value flag given no value', () => {
    // `--graphql` with no following value (the next token is another flag).
    const result = parseArgs(['--graphql', '--json']);
    expect(result.config).toEqual({});
    expect(result.json).toBe(true);
  });
});
