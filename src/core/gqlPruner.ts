import fs from 'fs';
import kleur from 'kleur';
import yaml from 'js-yaml';
import path from 'path';
import { OperationInfo } from '../types/OperationInfo.js';
import { GqlPruneConfig } from '../types/GqlPruneConfig.js';
import {
  directoryExists,
  findFilesWithExtension,
  isOperationUsed,
} from '../utils/fileUtils.js';
import { capitalizeFirstLetter } from '../utils/stringHelpers.js';
import { extractOperations } from '../utils/operations.js';
export function mainFunction() {
  let config: GqlPruneConfig;

  try {
    const configFile = fs.readFileSync('./gqlPrune.config.yaml', 'utf8');
    config = yaml.load(configFile) as GqlPruneConfig;
  } catch (e) {
    console.error('Error reading the config file:', e);
    process.exit(1);
  }

  if (!config || !directoryExists(config.graphqlDir || '')) {
    console.error(
      kleur.red(
        `Provided GraphQL directory "${config.graphqlDir}" does not exist.`,
      ),
    );
    process.exit(1);
  }

  if (!config || !directoryExists(config.srcDir || '')) {
    console.error(
      kleur.red(`Provided source directory "${config.srcDir}" does not exist.`),
    );
    process.exit(1);
  }

  let excludedFolders: string[] = [];

  if (Array.isArray(config.excludedFolders)) {
    excludedFolders = config.excludedFolders;
  } else if (typeof config.excludedFolders === 'string') {
    excludedFolders = [config.excludedFolders];
  }

  // ---------------- Main Logic ----------------

  const gqlFiles = findFilesWithExtension(
    config.graphqlDir || '',
    ['.gql', '.graphql'],
    excludedFolders,
  );
  const allOperations: OperationInfo[] = gqlFiles.flatMap(extractOperations);

  console.log(
    `Found ${kleur.yellow(gqlFiles.length.toString())} GraphQL files.`,
  );
  console.log(
    `Found ${kleur.yellow(
      allOperations.length.toString(),
    )} GraphQL operations.`,
  );

  const tsFiles = findFilesWithExtension(
    config.srcDir || '',
    ['.ts', '.tsx', '.js', '.jsx'],
    excludedFolders,
  );
  console.log(
    `Found ${kleur.yellow(tsFiles.length.toString())} TypeScript files.`,
  );
  const unusedOperations: OperationInfo[] = [];

  allOperations.forEach((op) => {
    const usagePattern = `use${capitalizeFirstLetter(
      op.name,
    )}${capitalizeFirstLetter(op.type)}`;
    const isUsed = tsFiles.some((file) => isOperationUsed(usagePattern, file));

    if (!isUsed) {
      unusedOperations.push(op);
    }
  });

  // Determine the maximum lengths for alignment
  const maxTypeLength = Math.max(
    ...unusedOperations.map((op) => op.type.length),
  );
  const maxNameLength = Math.max(
    ...unusedOperations.map((op) => op.name.length),
  );

  console.log(kleur.blue('\n--- Unused GraphQL Operations ---\n'));
  console.log(
    'Typ'.padEnd(maxTypeLength),
    'Operation'.padEnd(maxNameLength),
    'File',
  );
  unusedOperations.forEach((op) => {
    const type = op.type.padEnd(maxTypeLength);
    const name = op.name.padEnd(maxNameLength);
    const fileName = path.basename(op.filePath);

    console.log(
      `${kleur.yellow(type)} ${kleur.cyan(name)} ${kleur.magenta(fileName)}`,
    );
  });

  console.log(kleur.blue('---------------------------------'));

  if (unusedOperations.length > 0) {
    console.log(
      kleur.red(
        `Found ${unusedOperations.length} unused GraphQL operations. Please remove them.`,
      ),
    );
    process.exit(1);
  }
}
