import inquirer from 'inquirer';
import * as yaml from 'js-yaml';
import fs from 'fs';

/** Splits a comma-separated input into a trimmed list of folder names. */
export function splitFolders(input: string): string[] {
  return input.split(',').map((folder) => folder.trim());
}

export async function generateConfig() {
  const questions = [
    {
      type: 'input',
      name: 'graphqlDir',
      message: 'Enter the path to your GraphQL directory:',
      default: './path/to/graphql',
    },
    {
      type: 'input',
      name: 'srcDir',
      message: 'Enter the path to your source directory:',
      default: './path/to/src',
    },
    {
      type: 'input',
      name: 'excludedFolders',
      message: 'Enter the folders to exclude (comma separated if multiple):',
      default: 'node_modules',
      filter: splitFolders,
    },
  ];

  const answers = await inquirer.prompt(questions);

  // Write the answers to a configuration file
  fs.writeFileSync('./gqlPrune.config.yaml', yaml.dump(answers));
  console.log('Configuration generated successfully!');
}
