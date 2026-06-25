import { parseArgs } from '../src/utils/args';

describe('parseArgs', () => {
  it('defaults to no command, json=false, annotate=false', () => {
    expect(parseArgs([])).toEqual({
      command: undefined,
      json: false,
      annotate: false,
    });
  });

  it('parses the init command', () => {
    expect(parseArgs(['init'])).toEqual({
      command: 'init',
      json: false,
      annotate: false,
    });
  });

  it('parses the --json flag', () => {
    expect(parseArgs(['--json'])).toEqual({
      command: undefined,
      json: true,
      annotate: false,
    });
  });

  it('parses the --annotate flag', () => {
    expect(parseArgs(['--annotate'])).toEqual({
      command: undefined,
      json: false,
      annotate: true,
    });
  });

  it('parses a command together with flags in any order', () => {
    expect(parseArgs(['--json', 'init', '--annotate'])).toEqual({
      command: 'init',
      json: true,
      annotate: true,
    });
  });
});
