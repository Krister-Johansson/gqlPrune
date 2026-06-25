// cli.ts runs its dispatch on import, so each case re-executes it in an isolated
// module registry via require() — the standard jest pattern for this.
/* eslint-disable @typescript-eslint/no-require-imports */
describe('cli dispatch', () => {
  const realArgv = process.argv;

  afterEach(() => {
    process.argv = realArgv;
    jest.resetModules();
  });

  function runCli(args: string[]) {
    process.argv = ['node', 'cli', ...args];
    let mocks: {
      generateConfig: jest.Mock;
      mainFunction: jest.Mock;
    };
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

  it('runs the pruner by default (json=false)', () => {
    const { generateConfig, mainFunction } = runCli([]);
    expect(mainFunction).toHaveBeenCalledWith({ json: false });
    expect(generateConfig).not.toHaveBeenCalled();
  });

  it('passes --json through to the pruner', () => {
    const { generateConfig, mainFunction } = runCli(['--json']);
    expect(mainFunction).toHaveBeenCalledWith({ json: true });
    expect(generateConfig).not.toHaveBeenCalled();
  });
});
