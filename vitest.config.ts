import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The fast suites (run on every push, .github/workflows/test.yml):
//   unit    pure logic, no DB, no processes
//   engine  the real runner + actions against a real temp SQLite, with the
//           container/GitHub boundary faked (test/helpers/local-sandbox.ts)
// The e2e suite against a running instance lives in vitest.e2e.config.ts.
const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const alias = {
  '~': path('./app'),
  '#shared': path('./shared'),
  '#server': path('./server'),
  '#imports': path('./test/helpers/nitro-imports.ts'),
  'nitropack/runtime': path('./test/helpers/nitro-imports.ts'),
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['test/helpers/test-env.ts'],
        },
      },
      {
        resolve: { alias },
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
