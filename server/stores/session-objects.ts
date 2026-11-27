import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db, schema } from '#server/db'
import type { SessionObjectRow } from '#server/db/schema'
import type { SessionObject } from '#server/utils/sessions'

type ObjectRef = Pick<SessionObject, 'integration' | 'kind' | 'key'>

const o = schema.sessionObjects

// Issues before pull requests, then in attach order: the ticket is where a piece of work starts.
const primaryOrder = [sql`${o.kind} = 'pull_request'`, asc(o.id)]

export function findObjectRow(projectId: number, object: ObjectRef): SessionObjectRow | undefined {
  return db.select().from(o).where(and(
    eq(o.projectId, projectId),
    eq(o.integration, object.integration),
    eq(o.kind, object.kind),
    eq(o.key, object.key),
  )).get()
}

export function getObjectRow(id: number): SessionObjectRow | undefined {
  return db.select().from(o).where(eq(o.id, id)).get()
}

export function listSessionObjectRows(sessionId: number): SessionObjectRow[] {
  return db.select().from(o).where(eq(o.sessionId, sessionId)).orderBy(...primaryOrder).all()
}

export function listObjectRowsOfSessions(sessionIds: number[]): SessionObjectRow[] {
  if (!sessionIds.length) return []
  return db.select().from(o).where(inArray(o.sessionId, sessionIds)).orderBy(...primaryOrder).all()
}

// Correlated subquery for joins: the session's primary object id.
export const primaryObjectId = (sessionId: unknown) =>
  sql<number | null>`(select ${o.id} from ${o} where ${o.sessionId} = ${sessionId} order by ${sql.join(primaryOrder, sql`, `)} limit 1)`

export function insertObjectRow(sessionId: number, projectId: number, object: SessionObject, status: SessionObjectRow['status'] = 'open'): SessionObjectRow {
  return db.insert(o).values({
    sessionId,
    projectId,
    integration: object.integration,
    kind: object.kind,
    key: object.key,
    url: object.url ?? null,
    title: object.title ?? null,
    status,
  }).returning().get()
}

export function updateObjectRow(id: number, patch: Partial<Pick<SessionObjectRow, 'url' | 'title' | 'status'>>): void {
  db.update(o).set(patch).where(eq(o.id, id)).run()
}

export function sessionHasObjects(sessionId: number): boolean {
  return !!db.select({ id: o.id }).from(o).where(eq(o.sessionId, sessionId)).get()
}

export function deleteSessionObjectRows(sessionId: number): void {
  db.delete(o).where(eq(o.sessionId, sessionId)).run()
}
