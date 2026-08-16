// FIXTURE GraphQL Code Generator config, written in TypeScript so the e2e suite
// exercises the textual reader as well as the YAML one. Nothing compiles or
// runs this file. The client preset keeps documents inside source files, which
// is what turns gqlPrune's inline pass on without anyone asking for it.
const config = {
  schema: 'https://example.test/graphql',
  documents: ['./src/**/*.tsx'],
  generates: {
    './src/gql/': {
      preset: 'client',
    },
  },
};

export default config;
