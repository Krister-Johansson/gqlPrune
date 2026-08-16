// End-to-end suite: spawns the built CLI as a real process. Kept in its own
// Jest project so `npm test` stays the fast unit run, and so the coverage
// thresholds in jest.config.cjs keep describing the unit suite alone — an
// e2e run exercises src/ through a child process, which Jest cannot instrument,
// and folding it in would only distort the floors.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['<rootDir>/test/e2e/**/*.e2e.test.ts'],
  // Agent tooling creates temporary git worktrees under .claude/; keep them out
  // of the crawl, as jest.config.cjs does.
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/'],
  modulePathIgnorePatterns: ['/\\.claude/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { diagnostics: { ignoreCodes: [151002] } }],
  },
  // Spawning processes is slower than the mocked unit tests; the packaging case
  // raises its own limit further.
  testTimeout: 60_000,
  collectCoverage: false,
};
