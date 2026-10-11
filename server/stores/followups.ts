import { and, asc, eq, inArray } from 'drizzle-orm'
import { db, schema, type Executor } from '../db'
import type { Followup, NewFollowup } from '../db/schema'

type Scope = { runId: number } | { sessionId: number } | { sessionIds: number[] }

const ACTIVE: Followup['status'][] = ['queued', 'running']

export const followupColumns = {
  id: schema.followups.id,
  runId: schema.followups.runId,
  prompt: schema.followups.prompt,
  model: schema.followups.model,
  attachments: schema.followups.attachments,
  requestedBy: schema.followups.requestedBy,
  origin: schema.followups.origin,
  status: schema.followups.status,
  error: schema.followups.error,
  createdAt: schema.followups.createdAt,
  startedAt: schema.followups.startedAt,
  finishedAt: schema.followups.finishedAt,
}

function scoped(scope: Scope) {
  if ('runId' in scope) return eq(schema.followups.runId, scope.runId)
  if ('sessionId' in scope) return eq(schema.followups.sessionId, scope.sessionId)
  return inArray(schema.followups.sessionId, scope.sessionIds)
}

export function getFollowup(id: number): Followup | undefined {
  return db.select().from(schema.followups).where(eq(schema.followups.id, id)).get()
}

export function getFollowupView(id: number) {
  return db.select({ ...followupColumns, sessionId: schema.followups.sessionId }).from(schema.followups).where(eq(schema.followups.id, id)).get()
}

export function listSessionFollowupViews(sessionId: number) {
  return db.select(followupColumns).from(schema.followups)
    .where(eq(schema.followups.sessionId, sessionId))
    .orderBy(asc(schema.followups.id))
    .all()
}

export function listFollowupIds(scope: Scope): number[] {
  if ('sessionIds' in scope && !scope.sessionIds.length) return []
  return db.select({ id: schema.followups.id }).from(schema.followups).where(scoped(scope)).all().map(f => f.id)
}

export function sessionHasActiveFollowup(sessionId: number): boolean {
  return !!db.select({ id: schema.followups.id })
    .from(schema.followups)
    .where(and(eq(schema.followups.sessionId, sessionId), inArray(schema.followups.status, ACTIVE)))
    .get()
}

export function listRunningFollowupSessionIds(): number[] {
  return db.select({ sessionId: schema.followups.sessionId })
    .from(schema.followups)
    .where(eq(schema.followups.status, 'running'))
    .all()
    .map(f => f.sessionId)
}

export function listQueuedFollowups(): Pick<Followup, 'id' | 'sessionId'>[] {
  return db.select({ id: schema.followups.id, sessionId: schema.followups.sessionId })
    .from(schema.followups)
    .where(eq(schema.followups.status, 'queued'))
    .orderBy(asc(schema.followups.id))
    .all()
}

export function createFollowup(values: NewFollowup): Followup {
  return db.insert(schema.followups).values(values).returning().get()
}

export function updateFollowup(id: number, patch: Partial<NewFollowup>): Followup | undefined {
  return db.update(schema.followups).set(patch).where(eq(schema.followups.id, id)).returning().get()
}

// Claim-first: the fast lane and the dispatcher can both start a follow-up without double-running it.
export function claimQueuedFollowup(id: number): boolean {
  return db.update(schema.followups)
    .set({ status: 'running', startedAt: new Date() })
    .where(and(eq(schema.followups.id, id), eq(schema.followups.status, 'queued')))
    .run()
    .changes > 0
}

export function requeueFollowup(id: number): void {
  updateFollowup(id, { status: 'queued', error: null, startedAt: null, finishedAt: null })
}

export function cancelActiveFollowups(scope: { runId: number } | { sessionId: number }): number[] {
  return db.update(schema.followups)
    .set({ status: 'failed', error: 'Cancelled', finishedAt: new Date() })
    .where(and(scoped(scope), inArray(schema.followups.status, ACTIVE)))
    .returning({ id: schema.followups.id })
    .all()
    .map(f => f.id)
}

export function failInterruptedFollowups(error: string): void {
  db.update(schema.followups)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(eq(schema.followups.status, 'running'))
    .run()
}

export function deleteQueuedFollowup(id: number): void {
  db.delete(schema.followups).where(and(eq(schema.followups.id, id), eq(schema.followups.status, 'queued'))).run()
}

export function deleteFollowups(scope: Scope, tx: Executor = db): void {
  if ('sessionIds' in scope && !scope.sessionIds.length) return
  tx.delete(schema.followups).where(scoped(scope)).run()
}
