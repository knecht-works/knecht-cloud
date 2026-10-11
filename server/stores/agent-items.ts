import { asc, eq, inArray, max } from 'drizzle-orm'
import { db, schema, type Executor } from '../db'
import type { AgentItem } from '../db/schema'

type NewAgentItem = typeof schema.agentItems.$inferInsert
type Scope = { followupIds: number[] } | { sessionIds: number[] }

export function listAgentItems(followupIds: number[]): AgentItem[] {
  if (!followupIds.length) return []
  return db.select().from(schema.agentItems)
    .where(inArray(schema.agentItems.followupId, followupIds))
    .orderBy(asc(schema.agentItems.followupId), asc(schema.agentItems.seq))
    .all()
}

export function nextAgentItemSeq(followupId: number): number {
  const last = db.select({ value: max(schema.agentItems.seq) }).from(schema.agentItems).where(eq(schema.agentItems.followupId, followupId)).get()
  return (last?.value ?? -1) + 1
}

export function createAgentItem(values: NewAgentItem): AgentItem {
  return db.insert(schema.agentItems).values(values).returning().get()
}

export function updateAgentItem(id: number, patch: Partial<NewAgentItem>): AgentItem | undefined {
  return db.update(schema.agentItems).set(patch).where(eq(schema.agentItems.id, id)).returning().get()
}

export function deleteAgentItems(scope: Scope, tx: Executor = db): void {
  const where = 'followupIds' in scope
    ? (scope.followupIds.length ? inArray(schema.agentItems.followupId, scope.followupIds) : null)
    : (scope.sessionIds.length ? inArray(schema.agentItems.sessionId, scope.sessionIds) : null)
  if (where) tx.delete(schema.agentItems).where(where).run()
}
