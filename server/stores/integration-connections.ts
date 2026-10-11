import { eq } from 'drizzle-orm'
import { db } from '../db'
import { integrationConnections } from '../db/schema'
import type { IntegrationId } from '../../shared/utils/integrations'

type ConnectionRow = typeof integrationConnections.$inferSelect
type ConnectionFields = Omit<typeof integrationConnections.$inferInsert, 'integration'>

const byIntegration = (id: IntegrationId) => eq(integrationConnections.integration, id)

export function getConnectionRow(id: IntegrationId): ConnectionRow | undefined {
  return db.select().from(integrationConnections).where(byIntegration(id)).get()
}

export function upsertConnection(id: IntegrationId, row: ConnectionFields): void {
  db.insert(integrationConnections)
    .values({ integration: id, ...row })
    .onConflictDoUpdate({ target: integrationConnections.integration, set: row })
    .run()
}

export function updateConnection(id: IntegrationId, patch: Partial<ConnectionFields>): void {
  db.update(integrationConnections).set(patch).where(byIntegration(id)).run()
}

export function deleteConnection(id: IntegrationId): void {
  db.delete(integrationConnections).where(byIntegration(id)).run()
}
