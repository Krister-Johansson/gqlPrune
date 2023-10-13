GraphQL Unused Operations Checker
=================================

This script helps identify unused GraphQL operations (queries, mutations, subscriptions) in your project. It scans .gql files for operations and checks if they are being used in your TypeScript/JavaScript files.

Setup
-----

1. Install Dependencies:

   Before running the script, ensure you have the necessary dependencies installed:

   ```bach
   npm install
   ```

2. Environment Configuration:

   Create a .env file in the root directory of the script with the following structure:

   ```env
   GRAPHQL_DIR=path_to_your_graphql_files
   SRC_DIR=path_to_your_source_files
   EXCLUDED_FOLDERS=folder1,folder2,folder3
   GQL_FILE_EXTENSION=.gql,
   ```

   - GRAPHQL_DIR: Path to the directory containing your .gql files.
   - SRC_DIR: Path to the directory containing your source files (.ts, .tsx, .js, .jsx).
   - EXCLUDED_FOLDERS: Comma-separated list of folder names you want to exclude from the search (e.g., node_modules).
   - GQL_FILE_EXTENSION: The file extension used for your GraphQL files (e.g., .gql, .graphql).

Usage
-----

To run the script:

```bach
npm run check-unused-operations
```

This will display a list of unused GraphQL operations in the console.

Output
------

The script will output the type of operation (query, mutation, subscription), the name of the operation, and the filename where the operation is defined. For example:

```console
query: Customer in customers.query.gql is not used.
```

Customization
-------------

- To add more folders to the exclusion list, update the EXCLUDED_FOLDERS variable in the .env file.
