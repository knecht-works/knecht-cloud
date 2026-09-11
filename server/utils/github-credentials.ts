import { eq } from 'drizzle-orm'
import { db } from '../db'
import { githubApp } from '../db/schema'
import { decrypt, encrypt } from './crypto'

export interface GithubAppCredentials {
  appId: string
  clientId: string
  clientSecret: string
  privateKey: string
  webhookSecret: string | null
}

export interface SavableGithubApp {
  appId: string | number
  slug?: string | null
  htmlUrl?: string | null
  clientId: string
  clientSecret: string
  privateKey: string
  webhookSecret?: string | null
}

let cache: GithubAppCredentials | null | undefined

export function githubAppCredentials(): GithubAppCredentials | null {
  if (cache !== undefined) return cache

  const row = db.select().from(githubApp).where(eq(githubApp.id, 1)).get()
  cache = row
    ? {
        appId: row.appId,
        clientId: row.clientId,
        clientSecret: decrypt(row.clientSecretEnc),
        privateKey: decrypt(row.privateKeyEnc),
        webhookSecret: row.webhookSecretEnc ? decrypt(row.webhookSecretEnc) : null,
      }
    : devTestCredentials()
  return cache
}

function devTestCredentials(): GithubAppCredentials | null {
  if (!import.meta.dev) return null
  const appId = process.env.KNECHT_TEST_GITHUB_APP_ID
  const privateKey = process.env.KNECHT_TEST_GITHUB_APP_PRIVATE_KEY
  if (!appId || !privateKey) return null
  return { appId, clientId: '', clientSecret: '', privateKey, webhookSecret: null }
}

export function isGithubAppConfigured(): boolean {
  return githubAppCredentials() !== null
}

export function saveGithubAppCredentials(app: SavableGithubApp): void {
  db.insert(githubApp)
    .values({
      id: 1,
      appId: String(app.appId),
      slug: app.slug ?? null,
      htmlUrl: app.htmlUrl ?? null,
      clientId: app.clientId,
      clientSecretEnc: encrypt(app.clientSecret),
      privateKeyEnc: encrypt(app.privateKey),
      webhookSecretEnc: app.webhookSecret ? encrypt(app.webhookSecret) : null,
    })
    .run()
  cache = undefined
}
