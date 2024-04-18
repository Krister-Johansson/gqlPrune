import * as fs from 'fs';
import * as path from 'path';
const baseDir = path.resolve('./');

/**
 * Recursively finds all files in a directory with the specified extensions.
 *
 * @param {string} dir - The directory to start searching from.
 * @param {string[]} extensions - The list of file extensions to match.
 * @param {string[]} excludedFolders - Folders to exclude from the search, should be absolute paths.
 * @returns {string[]} - An array of file paths that match the given extensions.
 */
export function findFilesWithExtension(
  dir: string,
  extensions: string[],
  excludedFolders: string[],
): string[] {
  let files: string[] = [];
  const absDir = path.resolve(dir);

  try {
    const items = fs.readdirSync(dir);

    items.forEach((item) => {
      const itemPath = path.join(dir, item);
      const absItemPath = path.resolve(itemPath);
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
        const relativePath = path.relative(baseDir, absItemPath);
        console.log(`Checking directory: ${relativePath}`);
        if (!excludedFolders.includes(`./${relativePath}`)) {
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
