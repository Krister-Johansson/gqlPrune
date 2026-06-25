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
  });

  function runCli(args: string[], env: { GITHUB_ACTIONS?: string } = {}) {
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
        generateConfig: jest.fn(),
      }));
      jest.doMock('../src/core/gqlPruner', () => ({ mainFunction: jest.fn() }));
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
      config: {},
    });
  });

  it('passes --annotate through to the pruner', () => {
    const { mainFunction } = runCli(['--annotate']);
    expect(mainFunction).toHaveBeenCalledWith({
      json: false,
      annotate: true,
      config: {},
    });
  });

  it('auto-enables annotations under GitHub Actions', () => {
    const { mainFunction } = runCli([], { GITHUB_ACTIONS: 'true' });
    expect(mainFunction).toHaveBeenCalledWith({
      json: false,
      annotate: true,
      config: {},
    });
  });

  it('passes config flags through to the pruner', () => {
    const { mainFunction } = runCli(['--graphql', './g', '--src', './s']);
    expect(mainFunction).toHaveBeenCalledWith({
      json: false,
      annotate: false,
      config: { graphqlDir: './g', srcDir: './s' },
    });
  });
});
