# gqlPrune: GraphQL Unused Operations Checker

`gqlPrune` is a utility that identifies unused GraphQL operations (queries, mutations, subscriptions) in your project. It scans `.gql` files for operations and checks their usage in your TypeScript/JavaScript files.

## Setup

### Installation:

To install `gqlPrune`, run the following command:

```bash
npm install gqlPrune
```

### Configuration:

Upon running the `init` command with `gqlPrune`, it will launch a configurator that generates a configuration file named `gqlPrune.config.yaml`. This file should be located at the root of your project.

Example:

```bash
npm gqlPrune init
```

```yaml
graphqlDir: path_to_your_graphql_files
srcDir: path_to_your_source_files
excludedFolders:
  - folder_name_to_exclude
```

- `graphqlDir`: Directory path containing your `.gql` files.
- `srcDir`: Directory path containing your source files (e.g., `.ts`, `.tsx`, `.js`, `.jsx`).
- `excludedFolders`: List of folder names you wish to exclude from the search.

## Usage

To execute `gqlPrune`:

```bash
npx gqlPrune
```

This command will display a list of unused GraphQL operations in the console.

## Output

The utility outputs the type of operation (query, mutation, subscription), the operation's name, and the filename where the operation is defined. For instance:

```bash
query    OperationName       operationFile.query.gql
```

## Customization

To exclude additional folders from the search, simply update the `excludedFolders` list in the `gqlPrune.config.yaml` file.
