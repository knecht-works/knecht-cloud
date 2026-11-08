import { defineConfig } from 'vitest/config'

// Browser scenarios against a running instance, like vitest.e2e.config.ts, but
// driven through Playwright's Chromium. They run on the host, not in the dev
// container, which has no browser: .github/workflows/e2e.yml job `browser`.
export default defineConfig({
  test: {
    include: ['test/browser/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
