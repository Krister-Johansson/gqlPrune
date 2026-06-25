import { parseArgs } from '../src/utils/args';

describe('parseArgs', () => {
  it('defaults to no command and json=false', () => {
    expect(parseArgs([])).toEqual({ command: undefined, json: false });
  });

  it('parses the init command', () => {
    expect(parseArgs(['init'])).toEqual({ command: 'init', json: false });
  });

  it('parses the --json flag', () => {
    expect(parseArgs(['--json'])).toEqual({ command: undefined, json: true });
  });

  it('parses a command together with --json (any order)', () => {
    expect(parseArgs(['init', '--json'])).toEqual({
      command: 'init',
      json: true,
    });
    expect(parseArgs(['--json', 'init'])).toEqual({
      command: 'init',
      json: true,
    });
  });
});
