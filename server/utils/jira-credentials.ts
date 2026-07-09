import { eq } from 'drizzle-orm'
import { db } from '../db'
import { jiraConnection } from '../db/schema'
import { decrypt, encrypt } from './crypto'

// The single source of the Jira Cloud connection. It lives encrypted in the DB,
// saved from the Settings panel (server/api/jira/connection.post.ts). No DB
// row → not connected; 'jira' triggers then simply don't poll.

export interface JiraCredentials {
  siteUrl: string
  email: string
  apiToken: string
  accountName: string | null
}

// undefined = not loaded yet, null = loaded and not connected. Saving or
// disconnecting clears the cache for the in-process transition.
let cache: JiraCredentials | null | undefined

// The stored connection, or null when Jira is not connected.
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

// Persist a (validated) connection; the row is a singleton (id = 1), so saving
// replaces any previous connection.
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
