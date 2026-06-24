module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Allow ESM-style `.js` import specifiers in TypeScript source (required by
  // "module": "node16") to resolve to their `.ts` files under ts-jest.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
