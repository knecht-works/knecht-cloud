import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { integrationConnections } from '../db/schema'
import { decrypt, encrypt } from '../utils/crypto'
import { dashboardOrigin } from '../utils/origin'
import { keyPreview } from '../utils/settings'
import type { ConnectionFormDef, ConnectionStatus } from '../../shared/utils/connection-form'
import type { IntegrationId } from '../../shared/utils/integrations'
import type { DeliveryRecord } from './types'

export type Connection<F extends string> = Record<F, string> & {
  accountName: string | null
  accountId: string | null
  webhookSecret: string | null
}

export interface ConnectionAccount {
  accountName?: string | null
  accountId?: string | null
  webhookSecret?: string | null
}

export interface ConnectionStore {
  status(): ConnectionStatus
  save(values: Record<string, string>, account?: ConnectionAccount): void
  saveWebhookSecret(secret: string): void
  remove(): void
  recordDelivery(result: DeliveryRecord): void
}

export interface TypedConnectionStore<F extends string> extends ConnectionStore {
  credentials(): Connection<F> | null
  save(values: Record<F, string>, account?: ConnectionAccount): void
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000)

export function createConnectionStore<F extends string>(id: IntegrationId, form: ConnectionFormDef): TypedConnectionStore<F> {
  const where = eq(integrationConnections.integration, id)
  const secretKeys = new Set(form.fields.filter(f => f.type === 'secret').map(f => f.key))
  const minted = form.webhook.secret === 'minted'
  let cache: Connection<F> | null | undefined

  function credentials(): Connection<F> | null {
    if (cache !== undefined) return cache
    const row = db.select().from(integrationConnections).where(where).get()
    // A minted secret missing from an older connection is created here, so the row stays usable without a reconnect.
    if (row && minted && !row.webhookSecretEnc) {
      row.webhookSecretEnc = encrypt(randomBytes(32).toString('hex'))
      db.update(integrationConnections).set({ webhookSecretEnc: row.webhookSecretEnc }).where(where).run()
    }
    cache = row
      ? {
          ...row.config,
          ...Object.fromEntries(Object.entries(row.secretsEnc).map(([key, enc]) => [key, decrypt(enc)])),
          accountName: row.accountName,
          accountId: row.accountId,
          webhookSecret: row.webhookSecretEnc ? decrypt(row.webhookSecretEnc) : null,
        } as Connection<F>
      : null
    return cache
  }

  return {
    credentials,

    status() {
      const creds = credentials()
      const row = creds ? db.select().from(integrationConnections).where(where).get() : undefined
      const fields = form.fields.filter(f => creds?.[f.key as F])
      return {
        configured: !!creds,
        accountName: creds?.accountName ?? null,
        accountId: creds?.accountId ?? null,
        values: Object.fromEntries(fields.filter(f => !secretKeys.has(f.key)).map(f => [f.key, creds![f.key as F]])),
        previews: Object.fromEntries(fields.filter(f => secretKeys.has(f.key)).map(f => [f.key, keyPreview(creds![f.key as F])])),
        webhookUrl: creds ? `${dashboardOrigin()}/api/${id}/webhook` : null,
        webhookSecret: creds?.webhookSecret ?? null,
        lastDelivery: row?.lastDeliveryAt && row.lastDeliverySummary ? { at: seconds(row.lastDeliveryAt), summary: row.lastDeliverySummary } : null,
        lastRejected: row?.lastRejectedAt && row.lastRejectedReason ? { at: seconds(row.lastRejectedAt), reason: row.lastRejectedReason } : null,
      }
    },

    save(values, account = {}) {
      // The secret survives a reconnect: it belongs to the webhook registered in the tool, not to the credentials.
      const webhookSecret = account.webhookSecret || credentials()?.webhookSecret || (minted ? randomBytes(32).toString('hex') : null)
      const entries = Object.entries<string>(values)
      const row = {
        config: Object.fromEntries(entries.filter(([key]) => !secretKeys.has(key))),
        secretsEnc: Object.fromEntries(entries.filter(([key]) => secretKeys.has(key)).map(([key, value]) => [key, encrypt(value)])),
        accountName: account.accountName ?? null,
        accountId: account.accountId ?? null,
        webhookSecretEnc: webhookSecret ? encrypt(webhookSecret) : null,
      }
      db.insert(integrationConnections)
        .values({ integration: id, ...row })
        .onConflictDoUpdate({ target: integrationConnections.integration, set: row })
        .run()
      cache = undefined
    },

    saveWebhookSecret(secret) {
      db.update(integrationConnections).set({ webhookSecretEnc: encrypt(secret) }).where(where).run()
      cache = undefined
    },

    remove() {
      db.delete(integrationConnections).where(where).run()
      cache = undefined
    },

    recordDelivery(result) {
      db.update(integrationConnections)
        .set(result.ok
          ? { lastDeliveryAt: new Date(), lastDeliverySummary: result.summary }
          : { lastRejectedAt: new Date(), lastRejectedReason: result.reason })
        .where(where)
        .run()
    },
  }
}
