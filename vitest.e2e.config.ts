import { defineConfig } from 'vitest/config'

// The e2e suite drives a RUNNING instance over HTTP (no code is imported from
// the server): set KNECHT_E2E_BASE_URL and KNECHT_TEST_AUTH to point it at one.
// Locally that is the dev VM (http://lvh.me:3333); in CI a dev server started
// by .github/workflows/e2e.yml. Long timeouts: boot scenarios take minutes.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 120_000,
    // Scenarios share one instance; keep files strictly sequential.
    fileParallelism: false,
  },
})
