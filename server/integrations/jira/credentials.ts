import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { jiraConnection } from '../../db/schema'
import { decrypt, encrypt } from '../../utils/crypto'
import { dashboardOrigin } from '../../utils/origin'
import { keyPreview } from '../../utils/settings'

export interface JiraCredentials {
  siteUrl: string
  email: string
  apiToken: string
  accountName: string | null
  accountId: string | null
  webhookSecret: string | null
}

export const JIRA_WEBHOOK_EVENTS = ['jira:issue_created', 'jira:issue_updated', 'jira:issue_deleted', 'comment_created'] as const

export interface JiraConnectionStatus {
  configured: boolean
  siteUrl: string | null
  email: string | null
  accountName: string | null
  accountId: string | null
  apiTokenPreview: string | null
  webhookUrl: string | null
  webhookSecret: string | null
  webhookEvents: readonly string[]
}

let cache: JiraCredentials | null | undefined

export function jiraCredentials(): JiraCredentials | null {
  if (cache !== undefined) return cache

  const row = db.select().from(jiraConnection).where(eq(jiraConnection.id, 1)).get()
  // A connection from before webhooks has no secret yet; minting one here keeps the row usable without a reconnect.
  if (row && !row.webhookSecretEnc) {
    row.webhookSecretEnc = encrypt(randomBytes(32).toString('hex'))
    db.update(jiraConnection).set({ webhookSecretEnc: row.webhookSecretEnc }).where(eq(jiraConnection.id, 1)).run()
  }
  cache = row
    ? {
        siteUrl: row.siteUrl,
        email: row.email,
        apiToken: decrypt(row.apiTokenEnc),
        accountName: row.accountName,
        accountId: row.accountId,
        webhookSecret: row.webhookSecretEnc ? decrypt(row.webhookSecretEnc) : null,
      }
    : null
  return cache
}

export function isJiraConfigured(): boolean {
  return jiraCredentials() !== null
}

export function jiraConnectionStatus(): JiraConnectionStatus {
  const creds = jiraCredentials()
  return {
    configured: !!creds,
    siteUrl: creds?.siteUrl ?? null,
    email: creds?.email ?? null,
    accountName: creds?.accountName ?? null,
    accountId: creds?.accountId ?? null,
    apiTokenPreview: creds ? keyPreview(creds.apiToken) : null,
    webhookUrl: creds ? `${dashboardOrigin()}/api/jira/webhook` : null,
    webhookSecret: creds?.webhookSecret ?? null,
    webhookEvents: JIRA_WEBHOOK_EVENTS,
  }
}

export function saveJiraCredentials(creds: { siteUrl: string, email: string, apiToken: string, accountName?: string | null, accountId?: string | null }): void {
  // The secret survives a reconnect: the admin registered it in Jira once.
  const webhookSecret = jiraCredentials()?.webhookSecret ?? randomBytes(32).toString('hex')
  const values = {
    siteUrl: creds.siteUrl,
    email: creds.email,
    apiTokenEnc: encrypt(creds.apiToken),
    accountName: creds.accountName ?? null,
    accountId: creds.accountId ?? null,
    webhookSecretEnc: encrypt(webhookSecret),
  }
  db.insert(jiraConnection)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: jiraConnection.id, set: values })
    .run()
  cache = undefined
}

export function deleteJiraConnection(): void {
  db.delete(jiraConnection).where(eq(jiraConnection.id, 1)).run()
  cache = undefined
}
