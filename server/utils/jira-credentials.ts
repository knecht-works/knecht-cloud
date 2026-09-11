import { eq } from 'drizzle-orm'
import { db } from '../db'
import { jiraConnection } from '../db/schema'
import { decrypt, encrypt } from './crypto'

export interface JiraCredentials {
  siteUrl: string
  email: string
  apiToken: string
  accountName: string | null
}

let cache: JiraCredentials | null | undefined

export function jiraCredentials(): JiraCredentials | null {
  if (cache !== undefined) return cache

  const row = db.select().from(jiraConnection).where(eq(jiraConnection.id, 1)).get()
  cache = row
    ? {
        siteUrl: row.siteUrl,
        email: row.email,
        apiToken: decrypt(row.apiTokenEnc),
        accountName: row.accountName,
      }
    : null
  return cache
}

export function isJiraConfigured(): boolean {
  return jiraCredentials() !== null
}

export function saveJiraCredentials(creds: { siteUrl: string, email: string, apiToken: string, accountName?: string | null }): void {
  db.insert(jiraConnection)
    .values({
      id: 1,
      siteUrl: creds.siteUrl,
      email: creds.email,
      apiTokenEnc: encrypt(creds.apiToken),
      accountName: creds.accountName ?? null,
    })
    .onConflictDoUpdate({
      target: jiraConnection.id,
      set: {
        siteUrl: creds.siteUrl,
        email: creds.email,
        apiTokenEnc: encrypt(creds.apiToken),
        accountName: creds.accountName ?? null,
      },
    })
    .run()
  cache = undefined
}

export function deleteJiraConnection(): void {
  db.delete(jiraConnection).where(eq(jiraConnection.id, 1)).run()
  cache = undefined
}
