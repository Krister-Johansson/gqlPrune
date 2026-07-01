// cli.ts runs its dispatch on import, so each case re-executes it in an isolated
// module registry via require() — the standard jest pattern for this.
/* eslint-disable @typescript-eslint/no-require-imports */
describe('cli dispatch', () => {
  const realArgv = process.argv;
  const realGHA = process.env.GITHUB_ACTIONS;

  afterEach(() => {
    process.argv = realArgv;
    if (realGHA === undefined) {
      delete process.env.GITHUB_ACTIONS;
    } else {
      process.env.GITHUB_ACTIONS = realGHA;
    }
    jest.resetModules();
    process.exitCode = 0; // error paths set exitCode; don't leak to the runner
  });

  function runCli(
    args: string[],
    env: { GITHUB_ACTIONS?: string } = {},
    initError?: Error,
  ) {
    process.argv = ['node', 'cli', ...args];
    delete process.env.GITHUB_ACTIONS;
    if (env.GITHUB_ACTIONS !== undefined) {
      process.env.GITHUB_ACTIONS = env.GITHUB_ACTIONS;
    }
    let mocks: {
      generateConfig: jest.Mock;
      mainFunction: jest.Mock;
      notifyUpdate: jest.Mock;
    };
    jest.isolateModules(() => {
      jest.doMock('../src/core/configGenerator', () => ({
        generateConfig: jest
          .fn()
          .mockImplementation(() =>
            initError ? Promise.reject(initError) : Promise.resolve(),
          ),
      }));
      // Partial mock: cli.ts also imports the real escapeAnnotationMessage.
      jest.doMock('../src/core/gqlPruner', () => ({
        ...jest.requireActual('../src/core/gqlPruner'),
        mainFunction: jest.fn(),
      }));
      jest.doMock('../src/utils/updateNotifier', () => ({
        notifyUpdate: jest.fn(),
      }));
      // pkgInfo reads package.json via import.meta (ESM-only); stub it so the
      // CommonJS test transform never touches it.
      jest.doMock('../src/utils/pkgInfo', () => ({
        pkg: { name: 'gqlprune', version: '0.0.0-test' },
      }));
      const cfg = require('../src/core/configGenerator');
      const pruner = require('../src/core/gqlPruner');
      const notifier = require('../src/utils/updateNotifier');
      require('../src/cli');
      mocks = {
        generateConfig: cfg.generateConfig,
        mainFunction: pruner.mainFunction,
        notifyUpdate: notifier.notifyUpdate,
      };
    });
    // @ts-expect-error assigned synchronously inside isolateModules
    return mocks;
  }

  it('runs the config generator on "init"', () => {
    const { generateConfig, mainFunction } = runCli(['init']);
    expect(generateConfig).toHaveBeenCalledTimes(1);
    expect(mainFunction).not.toHaveBeenCalled();
  });

  it('prints the version and exits on --version', () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const { mainFunction, generateConfig, notifyUpdate } = runCli([
      '--version',
    ]);
    expect(logSpy).toHaveBeenCalledWith('0.0.0-test');
    expect(mainFunction).not.toHaveBeenCalled();
    expect(generateConfig).not.toHaveBeenCalled();
    expect(notifyUpdate).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('runs the pruner by default', () => {
    const { generateConfig, mainFunction } = runCli([]);
    expect(mainFunction).toHaveBeenCalledWith({
      json: false,
      annotate: false,
      verbose: false,
      config: {},
    });
    expect(generateConfig).not.toHaveBeenCalled();
  });

  it('checks for updates after running', () => {
    const { notifyUpdate } = runCli([]);
    expect(notifyUpdate).toHaveBeenCalledWith(
      { name: 'gqlprune', version: '0.0.0-test' },
      { json: false },
    );
  });

  it('passes --json through to the pruner', () => {
    const { mainFunction } = runCli(['--json']);
    expect(mainFunction).toHaveBeenCalledWith({
      json: true,
      annotate: false,
      verbose: false,
      config: {},
    });
  });

  it('passes --annotate through to the pruner', () => {
    const { mainFunction } = runCli(['--annotate']);
    expect(mainFunction).toHaveBeenCalledWith({
      json: false,
      annotate: true,
      verbose: false,
      config: {},
    });
  });

  it('passes --verbose through to the pruner', () => {
    const { mainFunction } = runCli(['--verbose']);
    expect(mainFunction).toHaveBeenCalledWith({
      json: false,
      annotate: false,
      verbose: true,
      config: {},
    });
  });

  it('auto-enables annotations under GitHub Actions', () => {
    const { mainFunction } = runCli([], { GITHUB_ACTIONS: 'true' });
    expect(mainFunction).toHaveBeenCalledWith({
      json: false,
      annotate: true,
      verbose: false,
      config: {},
    });
  });

  it('passes config flags through to the pruner', () => {
    const { mainFunction } = runCli(['--graphql', './g', '--src', './s']);
    expect(mainFunction).toHaveBeenCalledWith({
      json: false,
      annotate: false,
      verbose: false,
      config: { graphqlDir: './g', srcDir: './s' },
    });
  });

  it('prints usage and exits without running the pruner on --help', () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const { mainFunction, generateConfig, notifyUpdate } = runCli(['--help']);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Usage:');
    expect(mainFunction).not.toHaveBeenCalled();
    expect(generateConfig).not.toHaveBeenCalled();
    expect(notifyUpdate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
    logSpy.mockRestore();
  });

  it('reports an unknown flag on stderr and does not run', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { mainFunction, notifyUpdate } = runCli(['--jsn']);
    const errs = errorSpy.mock.calls.flat().join('\n');
    expect(errs).toContain('Unknown flag: --jsn');
    expect(errs).toContain('--help');
    expect(mainFunction).not.toHaveBeenCalled();
    expect(notifyUpdate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    errorSpy.mockRestore();
  });

  it('reports a missing flag value on stderr and does not run', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { mainFunction } = runCli(['--graphql']);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      'Missing value for --graphql',
    );
    expect(mainFunction).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    errorSpy.mockRestore();
  });

  it('emits usage errors as ::error annotations in --annotate mode', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { mainFunction } = runCli(['--jsn', '--annotate']);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      '::error::Unknown flag: --jsn',
    );
    expect(mainFunction).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    errorSpy.mockRestore();
  });

  it('emits usage errors as ::error annotations under GitHub Actions', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    runCli(['--jsn'], { GITHUB_ACTIONS: 'true' });
    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      '::error::Unknown flag: --jsn',
    );
    errorSpy.mockRestore();
  });

  it('escapes usage-error annotations per workflow-command rules', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    // A stray flag containing "%" must be %25-escaped inside ::error data.
    runCli(['--50%off', '--annotate']);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      '::error::Unknown flag: --50%25off',
    );
    errorSpy.mockRestore();
  });

  it('exits cleanly when an init prompt is aborted (Ctrl+C)', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    // inquirer rejects with an ExitPromptError when the user aborts a prompt.
    const abort = new Error('User force closed the prompt');
    abort.name = 'ExitPromptError';
    runCli(['init'], {}, abort);
    await new Promise(process.nextTick); // let run()'s catch handler settle

    const errs = errorSpy.mock.calls.flat();
    expect(errs).toContain('Aborted.');
    expect(errs).not.toContain(abort); // no stack trace for a deliberate exit
    expect(process.exitCode).toBe(2);
    errorSpy.mockRestore();
  });

  it('reports an unexpected init failure and exits 2', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const failure = new Error('disk full');
    runCli(['init'], {}, failure);
    await new Promise(process.nextTick);

    expect(errorSpy.mock.calls.flat()).toContain(failure);
    expect(process.exitCode).toBe(2);
    errorSpy.mockRestore();
  });

  it('rejects an unknown command', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { mainFunction, generateConfig } = runCli(['scna']);
    const errs = errorSpy.mock.calls.flat().join('\n');
    expect(errs).toContain('Unknown command: scna');
    expect(errs).toContain('--help');
    expect(mainFunction).not.toHaveBeenCalled();
    expect(generateConfig).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
    errorSpy.mockRestore();
  });
});
