// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import ts from 'typescript';
import {
  DEFAULT_COMPILER_OPTIONS,
  compilerOptionsFromConfig,
  loadCompilerOptions,
} from '../src/utils/tsconfig';

/** A ParseConfigHost over an in-memory file map, so no test touches the disk. */
function hostOf(files: Record<string, string>): ts.ParseConfigHost {
  return {
    useCaseSensitiveFileNames: true,
    fileExists: (file) => file in files,
    readFile: (file) => files[file],
    readDirectory: () => [],
  };
}

describe('DEFAULT_COMPILER_OPTIONS', () => {
  it('resolves like a bundler and reads JavaScript', () => {
    expect(DEFAULT_COMPILER_OPTIONS.moduleResolution).toBe(
      ts.ModuleResolutionKind.Bundler,
    );
    expect(DEFAULT_COMPILER_OPTIONS.allowJs).toBe(true);
  });
});

describe('compilerOptionsFromConfig', () => {
  it('keeps baseUrl and paths from the config', () => {
    const { options, errors } = compilerOptionsFromConfig(
      { compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } } },
      '/project/tsconfig.json',
      hostOf({}),
    );

    expect(errors).toEqual([]);
    expect(options.baseUrl).toBe('/project');
    expect(options.paths).toEqual({ '@app/*': ['src/*'] });
  });

  it('forces bundler resolution whatever the config says', () => {
    const { options } = compilerOptionsFromConfig(
      { compilerOptions: { moduleResolution: 'node16', module: 'node16' } },
      '/project/tsconfig.json',
      hostOf({}),
    );

    expect(options.moduleResolution).toBe(ts.ModuleResolutionKind.Bundler);
    expect(options.allowJs).toBe(true);
  });

  it('follows extends through the host', () => {
    const { options, errors } = compilerOptionsFromConfig(
      { extends: './tsconfig.base.json' },
      '/project/tsconfig.json',
      hostOf({
        '/project/tsconfig.base.json': JSON.stringify({
          compilerOptions: { baseUrl: './src' },
        }),
      }),
    );

    expect(errors).toEqual([]);
    expect(options.baseUrl).toBe('/project/src');
  });

  it('does not report the empty files list it asked for', () => {
    const { errors } = compilerOptionsFromConfig(
      { compilerOptions: {}, files: ['src/index.ts'] },
      '/project/tsconfig.json',
      hostOf({}),
    );

    expect(errors).toEqual([]);
  });

  it('reports an option it cannot understand and still returns options', () => {
    const { options, errors } = compilerOptionsFromConfig(
      { compilerOptions: { moduleResolution: 'sideways', baseUrl: '.' } },
      '/project/tsconfig.json',
      hostOf({}),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('moduleResolution');
    expect(options.baseUrl).toBe('/project');
  });

  it('treats a config that is not an object as empty', () => {
    const { options, errors } = compilerOptionsFromConfig(
      'nope',
      '/project/tsconfig.json',
      hostOf({}),
    );

    expect(errors).toEqual([]);
    expect(options.moduleResolution).toBe(ts.ModuleResolutionKind.Bundler);
  });
});

describe('loadCompilerOptions', () => {
  it('returns the defaults and no warning when there is no config file', () => {
    const warn = jest.fn();

    expect(loadCompilerOptions('/project/src', warn, hostOf({}))).toEqual(
      DEFAULT_COMPILER_OPTIONS,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads the nearest tsconfig above cwd', () => {
    const warn = jest.fn();

    const options = loadCompilerOptions(
      '/project/src/deep',
      warn,
      hostOf({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: 'src' },
        }),
      }),
    );

    expect(options.baseUrl).toBe('/project/src');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to jsconfig.json', () => {
    const options = loadCompilerOptions(
      '/project',
      jest.fn(),
      hostOf({
        '/project/jsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: 'app' },
        }),
      }),
    );

    expect(options.baseUrl).toBe('/project/app');
  });

  it('warns and falls back to the defaults when the file does not parse', () => {
    const warn = jest.fn();

    expect(
      loadCompilerOptions(
        '/project',
        warn,
        hostOf({ '/project/tsconfig.json': '{ not json' }),
      ),
    ).toEqual(DEFAULT_COMPILER_OPTIONS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('/project/tsconfig.json');
  });

  it('warns about a bad option but keeps the rest', () => {
    const warn = jest.fn();

    const options = loadCompilerOptions(
      '/project',
      warn,
      hostOf({
        '/project/tsconfig.json': JSON.stringify({
          compilerOptions: { moduleResolution: 'sideways', baseUrl: '.' },
        }),
      }),
    );

    expect(options.baseUrl).toBe('/project');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('/project/tsconfig.json');
    expect(warn.mock.calls[0][0]).toContain('moduleResolution');
  });
});
