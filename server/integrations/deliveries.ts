import { eq } from 'drizzle-orm'
import { db } from '../db'
import type { jiraConnection, planeConnection } from '../db/schema'
import type { DeliveryRecord } from './types'

// Every connection table of an integration without a delivery log carries the same four last_* columns.
type ConnectionTable = typeof jiraConnection | typeof planeConnection

export interface DeliveryStatus {
  lastDelivery: { at: number, summary: string } | null
  lastRejected: { at: number, reason: Extract<DeliveryRecord, { ok: false }>['reason'] } | null
}

export function recordDelivery(table: ConnectionTable, result: DeliveryRecord): void {
  db.update(table as typeof jiraConnection)
    .set(result.ok
      ? { lastDeliveryAt: new Date(), lastDeliverySummary: result.summary }
      : { lastRejectedAt: new Date(), lastRejectedReason: result.reason })
    .where(eq(table.id, 1))
    .run()
}

export function deliveryStatus(table: ConnectionTable): DeliveryStatus {
  const row = db
    .select({
      lastDeliveryAt: table.lastDeliveryAt,
      lastDeliverySummary: table.lastDeliverySummary,
      lastRejectedAt: table.lastRejectedAt,
      lastRejectedReason: table.lastRejectedReason,
    })
    .from(table as typeof jiraConnection)
    .where(eq(table.id, 1))
    .get()
  return {
    lastDelivery: row?.lastDeliveryAt && row.lastDeliverySummary
      ? { at: Math.floor(row.lastDeliveryAt.getTime() / 1000), summary: row.lastDeliverySummary }
      : null,
    lastRejected: row?.lastRejectedAt && row.lastRejectedReason
      ? { at: Math.floor(row.lastRejectedAt.getTime() / 1000), reason: row.lastRejectedReason }
      : null,
  }
}
