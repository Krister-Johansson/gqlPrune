module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // ts-jest suggests isolatedModules for node16 modules, but enabling it breaks
  // type-only imports from our `.d.ts` files under per-file transpilation. The
  // full `tsc` build covers type-checking, so silence the advisory here.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }],
  },
  // Allow ESM-style `.js` import specifiers in TypeScript source (required by
  // "module": "node16") to resolve to their `.ts` files under ts-jest.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    // ESM-only runtime shim (uses import.meta); not exercisable under the
    // CommonJS ts-jest transform, so it's mocked in tests and excluded here.
    '!src/utils/pkgInfo.ts',
  ],
  coverageReporters: ['text', 'lcov'],
  // Floor below current coverage (~97% stmts / 81% branches) so CI catches
  // regressions without failing on minor branch changes.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 75,
      functions: 90,
      lines: 90,
    },
  },
};
