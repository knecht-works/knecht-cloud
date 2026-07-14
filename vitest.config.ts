import { defineConfig } from 'vitest/config'

// The fast suites (run on every push, .github/workflows/test.yml):
//   unit    pure logic, no DB, no processes
//   engine  the real runner + actions against a real temp SQLite, with the
//           container/GitHub boundary faked (test/helpers/local-sandbox.ts)
// The e2e suite against a running instance lives in vitest.e2e.config.ts.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['test/helpers/test-env.ts'],
        },
      },
      {
        test: {
          name: 'engine',
          include: ['test/engine/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['test/engine/setup.ts'],
          testTimeout: 20_000,
        },
      },
    ],
  },
})
