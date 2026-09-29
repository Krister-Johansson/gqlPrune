// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import path from 'path';
import ts from 'typescript';

/**
 * The compiler options the module resolver runs with when the project has no
 * tsconfig, and the two settings it forces on top of any tsconfig it reads.
 *
 * Bundler resolution accepts extensionless specifiers, maps `./x.js` to
 * `x.ts`, and reads no package.json, which is what a scan wants: it follows
 * imports between the files it has already read and never into node_modules.
 * `allowJs` lets `.js`, `.jsx`, `.mjs` and `.cjs` files be resolution targets.
 */
export const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
};

/** parseJsonConfigFileContent's complaint about the empty `files` list we pass on purpose. */
const NO_INPUTS_DIAGNOSTIC = 18002;

/**
 * Turns the parsed JSON of a tsconfig into compiler options, keeping only what
 * resolution needs (`baseUrl`, `paths`, `rootDirs`, and the internal base path
 * that makes `paths` relative to the right directory) and forcing the two
 * defaults above. `files` and `include` are overridden to empty lists so the
 * compiler never enumerates the project; that is the scan's job.
 *
 * Pure apart from the host, so tests can pass an in-memory one.
 */
export function compilerOptionsFromConfig(
  json: unknown,
  configPath: string,
  host: ts.ParseConfigHost,
): { options: ts.CompilerOptions; errors: string[] } {
  const config =
    json !== null && typeof json === 'object' ? (json as object) : {};
  const parsed = ts.parseJsonConfigFileContent(
    { ...config, files: [], include: [] },
    host,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  const errors = parsed.errors
    .filter((diagnostic) => diagnostic.code !== NO_INPUTS_DIAGNOSTIC)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    );
  return {
    options: { ...parsed.options, ...DEFAULT_COMPILER_OPTIONS },
    errors,
  };
}

/**
 * Reads the nearest tsconfig.json (or jsconfig.json) at or above `cwd` and
 * returns its compiler options for module resolution. A project without one
 * gets the defaults silently; one whose config cannot be read or has an option
 * the compiler rejects gets a warning and, respectively, the defaults or the
 * options that did parse. Never throws: the user asked gqlPrune to scan, not to
 * validate their tsconfig. The host defaults to the real file system; tests
 * pass an in-memory one.
 */
export function loadCompilerOptions(
  cwd: string,
  onWarning: (message: string) => void,
  host: ts.ParseConfigHost = ts.sys,
): ts.CompilerOptions {
  const exists = (file: string): boolean => host.fileExists(file);
  const configPath =
    ts.findConfigFile(cwd, exists, 'tsconfig.json') ??
    ts.findConfigFile(cwd, exists, 'jsconfig.json');
  if (configPath === undefined) {
    return { ...DEFAULT_COMPILER_OPTIONS };
  }
  const read = ts.readConfigFile(configPath, (file) => host.readFile(file));
  if (read.error !== undefined) {
    onWarning(
      `Could not read ${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}. Path aliases from it will not resolve.`,
    );
    return { ...DEFAULT_COMPILER_OPTIONS };
  }
  const { options, errors } = compilerOptionsFromConfig(
    read.config,
    configPath,
    host,
  );
  for (const error of errors) {
    onWarning(
      `Problem in ${configPath}: ${error}. Path aliases from it may not resolve.`,
    );
  }
  return options;
}
