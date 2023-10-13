import inquirer from 'inquirer';
import yaml from 'js-yaml';
import fs from 'fs';

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
      name: 'gqlFileExtension',
      message:
        'Enter the GraphQL file extensions (comma separated if multiple):',
      default: '.gql',
      filter: (input: string) => input.split(',').map((ext) => ext.trim()), // Convert comma-separated string to array
    },
    {
      type: 'input',
      name: 'excludedFolders',
      message: 'Enter the folders to exclude (comma separated if multiple):',
      default: 'node_modules',
      filter: (input: string) =>
        input.split(',').map((folder) => folder.trim()), // Convert comma-separated string to array
    },
  ];

  const answers = await inquirer.prompt(questions);

  // Write the answers to a configuration file
  fs.writeFileSync('./gqlPrune2.config.yaml', yaml.dump(answers));
  console.log('Configuration generated successfully!');
}
