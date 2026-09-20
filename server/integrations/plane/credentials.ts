import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { planeConnection } from '../../db/schema'
import { decrypt, encrypt } from '../../utils/crypto'
import { dashboardOrigin } from '../../utils/origin'
import { keyPreview } from '../../utils/settings'
import { deliveryStatus, recordDelivery, type DeliveryStatus } from '../deliveries'
import type { DeliveryRecord } from '../types'

export interface PlaneCredentials {
  siteUrl: string
  workspaceSlug: string
  apiKey: string
  accountName: string | null
  accountId: string | null
  webhookSecret: string | null
}

export const PLANE_WEBHOOK_EVENTS = ['workitem.created', 'workitem.updated', 'workitem.archived', 'workitem.deleted', 'workitem.comment.created'] as const

export interface PlaneConnectionStatus extends DeliveryStatus {
  configured: boolean
  siteUrl: string | null
  workspaceSlug: string | null
  accountName: string | null
  accountId: string | null
  apiKeyPreview: string | null
  webhookUrl: string | null
  webhookSecret: string | null
  webhookEvents: readonly string[]
}

let cache: PlaneCredentials | null | undefined

export function planeCredentials(): PlaneCredentials | null {
  if (cache !== undefined) return cache
  const row = db.select().from(planeConnection).where(eq(planeConnection.id, 1)).get()
  cache = row
    ? {
        siteUrl: row.siteUrl,
        workspaceSlug: row.workspaceSlug,
        apiKey: decrypt(row.apiKeyEnc),
        accountName: row.accountName,
        accountId: row.accountId,
        webhookSecret: row.webhookSecretEnc ? decrypt(row.webhookSecretEnc) : null,
      }
    : null
  return cache
}

export function isPlaneConfigured(): boolean {
  return planeCredentials() !== null
}

export const recordPlaneDelivery = (result: DeliveryRecord) => recordDelivery(planeConnection, result)

export function planeConnectionStatus(): PlaneConnectionStatus {
  const creds = planeCredentials()
  return {
    configured: !!creds,
    siteUrl: creds?.siteUrl ?? null,
    workspaceSlug: creds?.workspaceSlug ?? null,
    accountName: creds?.accountName ?? null,
    accountId: creds?.accountId ?? null,
    apiKeyPreview: creds ? keyPreview(creds.apiKey) : null,
    webhookUrl: creds ? `${dashboardOrigin()}/api/plane/webhook` : null,
    webhookSecret: creds?.webhookSecret ?? null,
    webhookEvents: PLANE_WEBHOOK_EVENTS,
    ...deliveryStatus(planeConnection),
  }
}

export function savePlaneCredentials(creds: { siteUrl: string, workspaceSlug: string, apiKey: string, webhookSecret?: string | null, accountName?: string | null, accountId?: string | null }): void {
  // Reconnecting with a new API key keeps the secret: it belongs to the webhook in Plane, not to the key.
  const webhookSecret = creds.webhookSecret || planeCredentials()?.webhookSecret || null
  const values = {
    siteUrl: creds.siteUrl,
    workspaceSlug: creds.workspaceSlug,
    apiKeyEnc: encrypt(creds.apiKey),
    accountName: creds.accountName ?? null,
    accountId: creds.accountId ?? null,
    webhookSecretEnc: webhookSecret ? encrypt(webhookSecret) : null,
  }
  db.insert(planeConnection)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: planeConnection.id, set: values })
    .run()
  cache = undefined
}

export function savePlaneWebhookSecret(secret: string): void {
  db.update(planeConnection).set({ webhookSecretEnc: encrypt(secret) }).where(eq(planeConnection.id, 1)).run()
  cache = undefined
}

export function deletePlaneConnection(): void {
  db.delete(planeConnection).where(eq(planeConnection.id, 1)).run()
  cache = undefined
}
