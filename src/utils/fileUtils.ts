import * as fs from 'fs';
import * as path from 'path';
import picomatch from 'picomatch';

const baseDir = path.resolve('./');

/** Tests a project-root-relative path against the configured exclude patterns. */
export type ExcludeMatcher = (relativePath: string) => boolean;

/** The path of `itemPath` relative to the project root, as a posix string. */
function toRelativePosix(itemPath: string): string {
  return path.relative(baseDir, path.resolve(itemPath)).replace(/\\/g, '/');
}

/**
 * Builds a matcher from gitignore-flavored glob patterns. A pattern without a
 * slash matches anywhere (by basename); one with a slash is anchored to the
 * project root; `**` matches any depth; a leading `!` re-includes. Returns a
 * predicate over project-root-relative paths; never excludes when no positive
 * patterns are given.
 */
export function createExcludeMatcher(patterns: string[]): ExcludeMatcher {
  const cleaned = patterns.map((p) => p.trim()).filter(Boolean);
  const positives = cleaned.filter((p) => !p.startsWith('!'));
  const negatives = cleaned
    .filter((p) => p.startsWith('!'))
    .map((p) => p.slice(1));
  if (positives.length === 0) {
    return () => false;
  }
  const options = { dot: true, basename: true };
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
      } else if (extensions.includes(path.extname(item.name))) {
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
