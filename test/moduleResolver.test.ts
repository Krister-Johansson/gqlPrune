// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import ts from 'typescript';
import {
  createCorpusResolver,
  createMapResolver,
} from '../src/utils/moduleResolver';
import { DEFAULT_COMPILER_OPTIONS } from '../src/utils/tsconfig';

const corpus = [
  '/p/src/App.tsx',
  '/p/src/hooks.ts',
  '/p/src/api/index.ts',
  '/p/src/api/client.ts',
  '/p/src/api/client/index.ts',
  '/p/src/lib/util.js',
  '/p/src/lib/legacy.cjs',
  '/p/src/lib/modern.mjs',
];

describe('createCorpusResolver', () => {
  const resolver = createCorpusResolver(corpus);

  it('resolves an extensionless relative specifier to the .ts file next to the importer', () => {
    expect(resolver.resolve('./hooks', '/p/src/App.tsx')).toBe(
      '/p/src/hooks.ts',
    );
  });

  it('resolves a directory to its index file', () => {
    expect(resolver.resolve('./api', '/p/src/App.tsx')).toBe(
      '/p/src/api/index.ts',
    );
  });

  it('prefers a file over a directory index of the same name', () => {
    expect(resolver.resolve('./client', '/p/src/api/index.ts')).toBe(
      '/p/src/api/client.ts',
    );
  });

  it('resolves an explicit .js specifier to the .ts file', () => {
    expect(resolver.resolve('./hooks.js', '/p/src/App.tsx')).toBe(
      '/p/src/hooks.ts',
    );
  });

  it('resolves across directories', () => {
    expect(resolver.resolve('../hooks', '/p/src/api/client.ts')).toBe(
      '/p/src/hooks.ts',
    );
  });

  it('resolves JavaScript files in every module flavour', () => {
    expect(resolver.resolve('./lib/util', '/p/src/App.tsx')).toBe(
      '/p/src/lib/util.js',
    );
    expect(resolver.resolve('./lib/legacy.cjs', '/p/src/App.tsx')).toBe(
      '/p/src/lib/legacy.cjs',
    );
    expect(resolver.resolve('./lib/modern.mjs', '/p/src/App.tsx')).toBe(
      '/p/src/lib/modern.mjs',
    );
  });

  it('returns undefined for a bare package specifier', () => {
    expect(
      resolver.resolve('@apollo/client', '/p/src/App.tsx'),
    ).toBeUndefined();
    expect(resolver.resolve('react', '/p/src/App.tsx')).toBeUndefined();
  });

  it('returns undefined for a relative path outside the corpus', () => {
    expect(
      resolver.resolve('./generated/graphql', '/p/src/App.tsx'),
    ).toBeUndefined();
    expect(
      resolver.resolve('../../etc/passwd', '/p/src/App.tsx'),
    ).toBeUndefined();
  });

  it('follows a paths alias from the compiler options', () => {
    const aliased = createCorpusResolver(corpus, {
      ...DEFAULT_COMPILER_OPTIONS,
      baseUrl: '/p',
      paths: { '@app/*': ['src/*'] },
      pathsBasePath: '/p',
    } as ts.CompilerOptions);

    expect(aliased.resolve('@app/hooks', '/p/src/App.tsx')).toBe(
      '/p/src/hooks.ts',
    );
    expect(aliased.resolve('@other/hooks', '/p/src/App.tsx')).toBeUndefined();
  });

  it('accepts corpus paths written with backslashes', () => {
    const windows = createCorpusResolver([
      'C:\\p\\src\\App.tsx',
      'C:\\p\\src\\hooks.ts',
    ]);

    expect(windows.resolve('./hooks', 'C:/p/src/App.tsx')).toBe(
      'C:/p/src/hooks.ts',
    );
  });
});

describe('createMapResolver', () => {
  it('answers from the map and nothing else', () => {
    const resolver = createMapResolver({
      '/p/App.tsx': { './hooks': '/p/hooks.ts' },
    });

    expect(resolver.resolve('./hooks', '/p/App.tsx')).toBe('/p/hooks.ts');
    expect(resolver.resolve('./other', '/p/App.tsx')).toBeUndefined();
    expect(resolver.resolve('./hooks', '/p/Other.tsx')).toBeUndefined();
  });
});
