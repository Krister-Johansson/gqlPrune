// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import * as fs from 'fs';
import * as path from 'path';
import picomatch from 'picomatch';

const baseDir = path.resolve('./');

// Folders that are always excluded from traversal, regardless of config.
export const DEFAULT_EXCLUDED_FOLDERS = ['node_modules', '.git'];

/** Tests a project-root-relative path against the configured exclude patterns. */
export type ExcludeMatcher = (relativePath: string) => boolean;

/** The path of `itemPath` relative to the project root, as a posix string. */
function toRelativePosix(itemPath: string): string {
  return path.relative(baseDir, path.resolve(itemPath)).replace(/\\/g, '/');
}

/**
 * Rewrites one gitignore-flavored pattern into the globs that implement it.
 *
 * A `./` prefix and a trailing slash are spelling, not meaning, so both are
 * normalized away first: `./src/gql`, `src/gql/` and `src/gql` are one pattern.
 * A pattern without a slash names a file or folder anywhere in the tree, which
 * is `**\/` in front of it; one with a slash is anchored to the project root
 * and passes through. Either way it also gets a `/**` twin, so excluding a
 * directory excludes everything under it.
 *
 * Doing this by hand is what picomatch's `basename` option looks like it would
 * do. It does not: `basename` applies only to patterns with no slash, and it
 * makes every pattern that mixes a slash with glob magic match nothing at all.
 */
function toExcludeGlobs(pattern: string): string[] {
  const normalized = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  if (normalized === '') return [];
  const anchored = normalized.includes('/') ? normalized : `**/${normalized}`;
  return [anchored, `${anchored}/**`];
}

/**
 * Builds a matcher from gitignore-flavored glob patterns. A pattern without a
 * slash matches anywhere; one with a slash is anchored to the project root;
 * `**` matches any depth; a leading `!` re-includes. Returns a predicate over
 * project-root-relative paths; never excludes when no positive patterns are
 * given.
 *
 * As in gitignore, a `!` cannot re-include a path whose parent directory is
 * excluded: the walk never enters an excluded directory, so nothing inside it
 * is ever offered to this matcher.
 */
export function createExcludeMatcher(patterns: string[]): ExcludeMatcher {
  const cleaned = patterns.map((p) => p.trim()).filter(Boolean);
  const positives = cleaned
    .filter((p) => !p.startsWith('!'))
    .flatMap(toExcludeGlobs);
  const negatives = cleaned
    .filter((p) => p.startsWith('!'))
    .map((p) => p.slice(1))
    .flatMap(toExcludeGlobs);
  if (positives.length === 0) {
    return () => false;
  }
  const options = { dot: true };
  const matchPositive = picomatch(positives, options);
  const matchNegative: ExcludeMatcher = negatives.length
    ? picomatch(negatives, options)
    : () => false;
  return (relativePath) =>
    matchPositive(relativePath) && !matchNegative(relativePath);
}

/**
 * Recursively finds all files with the given extensions under `dir`, skipping
 * any directory or file whose project-root-relative path is excluded by
 * `isExcluded`.
 *
 * Directory symlinks are followed, but never into a real directory that was
 * already walked (`visited` tracks real paths), so symlink cycles terminate
 * and an aliased directory is scanned only once. Broken symlinks are logged
 * and skipped.
 *
 * @param {string} dir - The directory to start searching from.
 * @param {string[]} extensions - The list of file extensions to match.
 * @param {ExcludeMatcher} isExcluded - Predicate marking paths to skip.
 * @param {Set<string>} visited - Real paths of directories already walked.
 * @returns {string[]} - The matching file paths.
 */
export function findFilesWithExtension(
  dir: string,
  extensions: string[],
  isExcluded: ExcludeMatcher,
  visited: Set<string> = new Set(),
): string[] {
  let files: string[] = [];

  try {
    const realDir = fs.realpathSync(dir);
    if (visited.has(realDir)) {
      return files; // already walked (symlink cycle or aliased directory)
    }
    visited.add(realDir);

    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const itemPath = path.join(dir, item.name);

      if (isExcluded(toRelativePosix(itemPath))) {
        continue; // Skip excluded directories and files
      }

      // Dirents answer isDirectory() without a per-entry stat; only a symlink
      // needs a stat to learn what it points at.
      let isDirectory = item.isDirectory();
      if (item.isSymbolicLink()) {
        try {
          isDirectory = fs.statSync(itemPath).isDirectory();
        } catch (error) {
          console.error(`Error reading stats for: ${itemPath}`);
          if (error instanceof Error) {
            console.error(error.message);
          } else {
            console.error(error);
          }
          continue; // Broken symlink — skip it and continue with the next one
        }
      }

      if (isDirectory) {
        files = files.concat(
          findFilesWithExtension(itemPath, extensions, isExcluded, visited),
        );
      } else if (extensions.includes(path.extname(item.name).toLowerCase())) {
        files.push(itemPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory: ${dir}`);
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
  }

  return files;
}

/** The outcome of expanding a list of configured directory patterns. */
export type DirExpansion = {
  /** Literal directories, in configuration order, de-duplicated. */
  dirs: string[];
  /** The patterns that contain glob magic but matched no directory. */
  unmatched: string[];
};

/**
 * Walks `base` and returns every directory whose base-relative posix path
 * matches `glob`, with `prefix` (a `./`, if the pattern carried one) and `base`
 * put back in front so the result reads like the configured pattern.
 *
 * `node_modules` and `.git` are never entered. Directory symlinks are followed
 * as {@link findFilesWithExtension} follows them, with `visited` tracking real
 * paths so a cycle terminates. A glob without `**` (or a brace, whose segments
 * cannot be counted this way) only needs as many levels as it has segments, so
 * the walk stops there rather than reading the whole tree.
 */
function findMatchingDirs(
  base: string,
  glob: string,
  prefix: string,
): string[] {
  // A trailing `**` reads as "this directory and everything under it", so the
  // directory the glob points at is a match in its own right. picomatch cannot
  // express that: no glob matches the empty relative path. Stripping the `/**`
  // gives the pattern that does, and a bare `**` means the walk's own base.
  const globs = glob.endsWith('/**') ? [glob, glob.slice(0, -3)] : [glob];
  const isMatch = picomatch(globs, { dot: true });
  const depthLimit = /\*\*|\{/.test(glob) ? Infinity : glob.split('/').length;
  const matches: string[] = [];
  const visited = new Set<string>();
  if (glob === '**' && base !== '') {
    matches.push(`${prefix}${base}`);
  }

  const walk = (dir: string, relative: string, depth: number): void => {
    let items: fs.Dirent[];
    try {
      const realDir = fs.realpathSync(dir);
      if (visited.has(realDir)) return; // symlink cycle or aliased directory
      visited.add(realDir);
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // an unreadable directory simply contributes no matches
    }

    for (const item of items) {
      if (DEFAULT_EXCLUDED_FOLDERS.includes(item.name)) continue;
      const itemPath = path.join(dir, item.name);

      let isDirectory = item.isDirectory();
      if (!isDirectory && item.isSymbolicLink()) {
        try {
          isDirectory = fs.statSync(itemPath).isDirectory();
        } catch {
          continue; // broken symlink
        }
      }
      if (!isDirectory) continue;

      const itemRelative =
        relative === '' ? item.name : `${relative}/${item.name}`;
      if (isMatch(itemRelative)) {
        matches.push(
          `${prefix}${base === '' ? '' : `${base}/`}${itemRelative}`,
        );
      }
      if (depth + 1 < depthLimit) walk(itemPath, itemRelative, depth + 1);
    }
  };

  walk(base === '' ? '.' : base, '', 0);
  return matches;
}

/**
 * Whether a glob's static base reaches into a folder that is always excluded,
 * such as `node_modules/*` or `vendor/node_modules/*`. The base is the part of
 * the pattern the walk starts from, so it is never filtered by the walk itself.
 */
function baseEntersExcludedFolder(base: string): boolean {
  return base
    .split('/')
    .some((segment) => DEFAULT_EXCLUDED_FOLDERS.includes(segment));
}

/**
 * Expands the glob patterns in a `graphqlDir`/`srcDir` list into the directories
 * they match, leaving plain paths alone.
 *
 * An entry without glob magic passes through untouched whether or not it exists,
 * so the caller's missing-directory check still reports it. An entry with glob
 * magic is expanded against the filesystem, and is returned in `unmatched` when
 * it matches nothing, because a pattern that quietly scans zero directories is a
 * configuration mistake rather than a clean run.
 *
 * A glob whose base is inside `node_modules` or `.git` matches nothing at all:
 * the walk skips those names as it descends, but it never re-examines the
 * directory it starts from, so the base has to be checked here. Checking the
 * base is enough to keep every expanded path clear of them, because no other
 * segment of a match can be an excluded name.
 *
 * @param {string[]} patterns - The configured directories and glob patterns.
 * @returns {DirExpansion} - The literal directories plus any empty patterns.
 */
export function expandDirPatterns(patterns: string[]): DirExpansion {
  const dirs: string[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  const add = (dir: string): void => {
    if (seen.has(dir)) return;
    seen.add(dir);
    dirs.push(dir);
  };

  for (const pattern of patterns) {
    // `scan` splits a pattern into its static base and the glob that follows,
    // and normalizes a leading `./` into `prefix`, so `./packages/*/graphql`
    // and `packages/*/graphql` match identically.
    const { isGlob, base, glob, prefix } = picomatch.scan(pattern);
    if (!isGlob) {
      add(pattern);
      continue;
    }
    if (baseEntersExcludedFolder(base)) {
      unmatched.push(pattern);
      continue;
    }
    const matches = findMatchingDirs(base, glob, prefix);
    if (matches.length === 0) {
      unmatched.push(pattern);
      continue;
    }
    matches.forEach(add);
  }

  return { dirs, unmatched };
}

/** A source file path paired with its contents. */
export type SourceFile = { file: string; content: string };

/**
 * Reads multiple files once, keeping each path paired with its contents and
 * skipping any that cannot be read. Pairing (rather than returning a bare
 * content array aligned by index) keeps a file's identity intact even when an
 * earlier file in the list fails to read.
 *
 * @param {string[]} filePaths - The files to read.
 * @returns {SourceFile[]} - One entry per readable file.
 */
export function readSourceFiles(filePaths: string[]): SourceFile[] {
  const sources: SourceFile[] = [];
  for (const file of filePaths) {
    try {
      sources.push({ file, content: fs.readFileSync(file, 'utf-8') });
    } catch (error) {
      console.error(`Error reading file: ${file}`);
      if (error instanceof Error) {
        console.error(error.message);
      } else {
        console.error(error);
      }
    }
  }
  return sources;
}

/**
 * Checks whether any of the given patterns appears in any of the provided file
 * contents. Operating on already-read contents avoids re-reading every source
 * file once per operation.
 *
 * @param {string[]} patterns - The search strings that indicate usage.
 * @param {string[]} contents - The file contents to search within.
 * @returns {boolean} - True if any pattern is found in any content.
 */
export function isOperationUsedInContents(
  patterns: string[],
  contents: string[],
): boolean {
  return contents.some((content) =>
    patterns.some((pattern) => content.includes(pattern)),
  );
}

/**
 * Checks if a directory exists.
 *
 * @param {string} directoryPath - The path to the directory.
 * @returns {boolean} - Returns true if the directory exists, otherwise false.
 */
export function directoryExists(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}
