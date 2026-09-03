module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Agent tooling creates temporary git worktrees under .claude/; without this,
  // a bare test run also compiles those trees' stale sources and fails there.
  // test/e2e/ is a separate project (jest.e2e.config.cjs, `npm run test:e2e`):
  // it needs a build first and spawns processes, so it must not slow down or
  // skew a bare `npm test`.
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/', '/test/e2e/'],
  modulePathIgnorePatterns: ['/\\.claude/'],
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
  // Floor below current coverage (~99% stmts / 93% branches) so CI catches
  // regressions without failing on minor branch changes.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 80,
      functions: 90,
      lines: 90,
    },
  },
};
