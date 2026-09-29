// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import path from 'path';
import ts from 'typescript';
import { DEFAULT_COMPILER_OPTIONS } from './tsconfig.js';

/**
 * Answers "which file does this specifier name, seen from this file?" with a
 * path inside the scanned corpus, or undefined when the target is a package,
 * a file the scan did not read, or nothing at all. The reference index treats
 * undefined as "outside": the chain stops and the last known name stands.
 */
export interface ModuleResolver {
  resolve(specifier: string, fromPath: string): string | undefined;
}

/** Forward slashes throughout, which is also what the compiler hands back. */
function toPosix(file: string): string {
  return file.split('\\').join('/');
}

function isRelativeOrAbsolute(specifier: string): boolean {
  return (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(specifier)
  );
}

/**
 * A resolver over the set of files the scan read, backed by the compiler's
 * own module resolution but with an in-memory host: nothing is stat'ed or
 * read from disk, so a resolution can only ever land on a corpus file.
 *
 * Bare specifiers (`react`, `@acme/graphql`) short-circuit to undefined unless
 * the compiler options carry `paths` or `baseUrl`, which is the one way a bare
 * name can mean a project file; that skips the node_modules walk entirely.
 */
export function createCorpusResolver(
  paths: Iterable<string>,
  options: ts.CompilerOptions = DEFAULT_COMPILER_OPTIONS,
  cwd: string = process.cwd(),
): ModuleResolver {
  const files = new Set<string>();
  const directories = new Set<string>();
  for (const file of paths) {
    const posix = toPosix(file);
    files.add(posix);
    let dir = path.posix.dirname(posix);
    while (!directories.has(dir)) {
      directories.add(dir);
      const parent = path.posix.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const host: ts.ModuleResolutionHost = {
    fileExists: (file) => files.has(toPosix(file)),
    directoryExists: (dir) => directories.has(toPosix(dir)),
    readFile: () => undefined,
    useCaseSensitiveFileNames: true,
  };
  const canAliasBareNames =
    options.paths !== undefined || options.baseUrl !== undefined;
  const cache = ts.createModuleResolutionCache(
    toPosix(cwd),
    (file) => file,
    options,
  );
  return {
    resolve(specifier, fromPath) {
      if (!canAliasBareNames && !isRelativeOrAbsolute(specifier)) {
        return undefined;
      }
      const resolved = ts.resolveModuleName(
        specifier,
        toPosix(fromPath),
        options,
        host,
        cache,
      ).resolvedModule?.resolvedFileName;
      return resolved !== undefined && files.has(resolved)
        ? resolved
        : undefined;
    },
  };
}

/**
 * A resolver for tests: `map[fromPath][specifier]` is the answer, anything
 * else is outside the corpus.
 */
export function createMapResolver(
  map: Record<string, Record<string, string>>,
): ModuleResolver {
  return {
    resolve: (specifier, fromPath) => map[fromPath]?.[specifier],
  };
}
