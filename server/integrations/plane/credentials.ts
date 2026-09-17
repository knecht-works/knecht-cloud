import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { planeConnection } from '../../db/schema'
import { decrypt, encrypt } from '../../utils/crypto'
import { dashboardOrigin } from '../../utils/origin'
import { keyPreview } from '../../utils/settings'

export interface PlaneCredentials {
  siteUrl: string
  workspaceSlug: string
  apiKey: string
  accountName: string | null
  accountId: string | null
  webhookSecret: string | null
}

export const PLANE_WEBHOOK_EVENTS = ['workitem.created', 'workitem.updated', 'workitem.archived', 'workitem.deleted', 'workitem.comment.created'] as const

export type PlaneRejectReason = 'signature' | 'empty-body' | 'no-project'

export interface PlaneConnectionStatus {
  configured: boolean
  siteUrl: string | null
  workspaceSlug: string | null
  accountName: string | null
  accountId: string | null
  apiKeyPreview: string | null
  webhookUrl: string | null
  webhookSecretConfigured: boolean
  webhookEvents: readonly string[]
  lastDelivery: { at: number, summary: string } | null
  lastRejected: { at: number, reason: PlaneRejectReason } | null
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

export function recordPlaneDelivery(result: { ok: true, summary: string } | { ok: false, reason: PlaneRejectReason }): void {
  db.update(planeConnection)
    .set(result.ok
      ? { lastDeliveryAt: new Date(), lastDeliverySummary: result.summary }
      : { lastRejectedAt: new Date(), lastRejectedReason: result.reason })
    .where(eq(planeConnection.id, 1))
    .run()
}

export function planeConnectionStatus(): PlaneConnectionStatus {
  const creds = planeCredentials()
  const row = db
    .select({
      lastDeliveryAt: planeConnection.lastDeliveryAt,
      lastDeliverySummary: planeConnection.lastDeliverySummary,
      lastRejectedAt: planeConnection.lastRejectedAt,
      lastRejectedReason: planeConnection.lastRejectedReason,
    })
    .from(planeConnection)
    .where(eq(planeConnection.id, 1))
    .get()
  return {
    configured: !!creds,
    siteUrl: creds?.siteUrl ?? null,
    workspaceSlug: creds?.workspaceSlug ?? null,
    accountName: creds?.accountName ?? null,
    accountId: creds?.accountId ?? null,
    apiKeyPreview: creds ? keyPreview(creds.apiKey) : null,
    webhookUrl: creds ? `${dashboardOrigin()}/api/plane/webhook` : null,
    webhookSecretConfigured: !!creds?.webhookSecret,
    webhookEvents: PLANE_WEBHOOK_EVENTS,
    lastDelivery: row?.lastDeliveryAt && row.lastDeliverySummary
      ? { at: Math.floor(row.lastDeliveryAt.getTime() / 1000), summary: row.lastDeliverySummary }
      : null,
    lastRejected: row?.lastRejectedAt && row.lastRejectedReason
      ? { at: Math.floor(row.lastRejectedAt.getTime() / 1000), reason: row.lastRejectedReason }
      : null,
  }
}

export function savePlaneCredentials(creds: { siteUrl: string, workspaceSlug: string, apiKey: string, webhookSecret?: string | null, accountName?: string | null, accountId?: string | null }): void {
  // An empty secret keeps the stored one: the admin re-enters the API key without re-pasting Plane's secret.
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

export function deletePlaneConnection(): void {
  db.delete(planeConnection).where(eq(planeConnection.id, 1)).run()
  cache = undefined
}
