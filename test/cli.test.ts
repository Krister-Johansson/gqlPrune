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
    let mocks: { generateConfig: jest.Mock; mainFunction: jest.Mock };
    jest.isolateModules(() => {
      jest.doMock('../src/core/configGenerator', () => ({
        generateConfig: jest.fn(),
      }));
      jest.doMock('../src/core/gqlPruner', () => ({ mainFunction: jest.fn() }));
      const cfg = require('../src/core/configGenerator');
      const pruner = require('../src/core/gqlPruner');
      require('../src/cli');
      mocks = {
        generateConfig: cfg.generateConfig,
        mainFunction: pruner.mainFunction,
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

  it('runs the pruner by default', () => {
    const { generateConfig, mainFunction } = runCli([]);
    expect(mainFunction).toHaveBeenCalledWith({ json: false, annotate: false });
    expect(generateConfig).not.toHaveBeenCalled();
  });

  it('passes --json through to the pruner', () => {
    const { mainFunction } = runCli(['--json']);
    expect(mainFunction).toHaveBeenCalledWith({ json: true, annotate: false });
  });

  it('passes --annotate through to the pruner', () => {
    const { mainFunction } = runCli(['--annotate']);
    expect(mainFunction).toHaveBeenCalledWith({ json: false, annotate: true });
  });

  it('auto-enables annotations under GitHub Actions', () => {
    const { mainFunction } = runCli([], { GITHUB_ACTIONS: 'true' });
    expect(mainFunction).toHaveBeenCalledWith({ json: false, annotate: true });
  });
});
