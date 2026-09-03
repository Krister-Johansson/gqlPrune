// FIXTURE GraphQL Code Generator config; nothing compiles or runs it. It is the
// only place this project's directories are configured, so a gqlPrune run here
// takes graphqlDir, srcDir, exclude and inline from it.
const config = {
  schema: './schema.graphql',
  documents: ['./graphql/**/*.gql', './src/**/*.tsx'],
  generates: {
    './src/__generated__/': {
      preset: 'client',
    },
  },
};

export default config;
