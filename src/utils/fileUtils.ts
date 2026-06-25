import * as fs from 'fs';
import * as path from 'path';
const baseDir = path.resolve('./');

/**
 * Normalizes a folder entry so it can be matched reliably across platforms:
 * converts backslashes to forward slashes (Windows `path.relative` output),
 * trims whitespace, and strips a leading `./` and any trailing slashes.
 */
function normalizeFolder(folder: string): string {
  return folder
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

/**
 * Determines whether a directory should be skipped during traversal.
 *
 * A directory is excluded when either its basename (e.g. `node_modules`,
 * `__generated__`) or its path relative to the project root (e.g.
 * `src/generated`) matches an entry in `excludedFolders`. Entries may be given
 * with or without a leading `./`.
 *
 * @param {string} itemPath - The path to the directory being considered.
 * @param {string[]} excludedFolders - Folder names or relative paths to exclude.
 * @returns {boolean} - True if the directory should be skipped.
 */
export function isExcludedFolder(
  itemPath: string,
  excludedFolders: string[],
): boolean {
  const excluded = new Set(
    excludedFolders.map(normalizeFolder).filter(Boolean),
  );
  if (excluded.size === 0) {
    return false;
  }
  const name = path.basename(itemPath);
  const relativePath = normalizeFolder(
    path.relative(baseDir, path.resolve(itemPath)),
  );
  return excluded.has(name) || excluded.has(relativePath);
}

/**
 * Recursively finds all files in a directory with the specified extensions.
 *
 * @param {string} dir - The directory to start searching from.
 * @param {string[]} extensions - The list of file extensions to match.
 * @param {string[]} excludedFolders - Folder names or relative paths to exclude.
 * @returns {string[]} - An array of file paths that match the given extensions.
 */
export function findFilesWithExtension(
  dir: string,
  extensions: string[],
  excludedFolders: string[],
): string[] {
  let files: string[] = [];

  try {
    const items = fs.readdirSync(dir);

    items.forEach((item) => {
      const itemPath = path.join(dir, item);
      let stat;

      try {
        stat = fs.statSync(itemPath);
      } catch (error) {
        console.error(`Error reading stats for: ${itemPath}`);
        if (error instanceof Error) {
          console.error(error.message);
        } else {
          console.error(error);
        }
        return; // Skip this item and continue with the next one
      }

      if (stat.isDirectory()) {
        if (!isExcludedFolder(itemPath, excludedFolders)) {
          files = files.concat(
            findFilesWithExtension(itemPath, extensions, excludedFolders),
          );
        }
      } else if (extensions.includes(path.extname(item))) {
        files.push(itemPath);
      }
    });
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
 * Reads the contents of multiple files once, skipping any that cannot be read.
 *
 * @param {string[]} filePaths - The files to read.
 * @returns {string[]} - The contents of the readable files.
 */
export function readFileContents(filePaths: string[]): string[] {
  return readSourceFiles(filePaths).map((source) => source.content);
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
 * Checks if a specific operation is used within a file.
 *
 * @param {string} operation - The operation to search for.
 * @param {string} filePath - The path to the file to search within.
 * @returns {boolean} - Returns true if the operation is found in the file, otherwise false.
 */
export function isOperationUsed(operation: string, filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.includes(operation);
  } catch (error) {
    console.error(`Error reading file: ${filePath}`);
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    return false;
  }
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
