import { isGithubAppConfigured, saveGithubAppCredentials } from '../utils/github-credentials'

// Dev-only credential seed: lets an automated instance (the CI boot e2e, a
// fresh dev VM) run workflows without the interactive manifest setup. When
// KNECHT_TEST_GITHUB_APP_ID and KNECHT_TEST_GITHUB_APP_PRIVATE_KEY are set and
// the instance is not configured yet, they are stored exactly like the setup
// callback would store them. Repo access (clone/push/PR) only needs app id +
// private key; the OAuth client fields get placeholders, so browser login
// stays unavailable on such an instance: automation logs in via /_test/login.
//
// Dead code in production builds (import.meta.dev), like /_test/login.
export default defineNitroPlugin(() => {
  if (!import.meta.dev) return
  const appId = process.env.KNECHT_TEST_GITHUB_APP_ID
  const privateKey = process.env.KNECHT_TEST_GITHUB_APP_PRIVATE_KEY
  if (!appId || !privateKey || isGithubAppConfigured()) return
  saveGithubAppCredentials({ appId, clientId: 'test-only', clientSecret: 'test-only', privateKey })
  console.log('Seeded GitHub App credentials from KNECHT_TEST_GITHUB_APP_* (dev-only)')
})
