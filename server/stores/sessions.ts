import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { createError } from 'h3'
import { db, schema, type Executor } from '../db'
import type { NewSession, Run, Session } from '../db/schema'
import type { SessionObject } from '../utils/sessions'
import { liveTopics } from '../../shared/utils/live-topics'
import { emitTopics } from '../utils/live'
import { listSessionRunIds } from './runs'

export function getSessionRow(id: number): Session | undefined {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
}

export function requireSession(id: number): Session {
  const session = getSessionRow(id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  return session
}

export function requireRunSession(run: Run): Session {
  return requireSession(run.sessionId)
}

export function findObjectSession(projectId: number, object: SessionObject): Session | undefined {
  return db
    .select()
    .from(schema.sessions)
    .where(and(
      eq(schema.sessions.projectId, projectId),
      eq(schema.sessions.objectIntegration, object.integration),
      eq(schema.sessions.objectKind, object.kind),
      eq(schema.sessions.objectKey, object.key),
    ))
    .get()
}

export function listSessionIds(projectId?: number): number[] {
  return db.select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(projectId === undefined ? undefined : eq(schema.sessions.projectId, projectId))
    .all()
    .map(s => s.id)
}

export function listSessionsInEnvState(
  envState: Session['envState'],
  { projectId, seenBefore }: { projectId?: number, seenBefore?: Date } = {},
): Session[] {
  return db.select()
    .from(schema.sessions)
    .where(and(
      eq(schema.sessions.envState, envState),
      projectId === undefined ? undefined : eq(schema.sessions.projectId, projectId),
      seenBefore === undefined ? undefined : lt(schema.sessions.previewLastSeen, seenBefore),
    ))
    .orderBy(desc(schema.sessions.previewLastSeen))
    .all()
}

export function createSession(values: NewSession): Session {
  return db.insert(schema.sessions).values(values).returning().get()
}

// Run views join their session, so a session change is a change of its runs.
export function sessionChanged(id: number): void {
  emitTopics(liveTopics.runs, ...listSessionRunIds(id).map(liveTopics.run))
}

export function updateSession(id: number, patch: Partial<NewSession>): void {
  db.update(schema.sessions).set(patch).where(eq(schema.sessions.id, id)).run()
  sessionChanged(id)
}

// Compare-and-set: false when another writer moved the session first.
export function moveSession(id: number, from: Partial<Pick<Session, 'envState' | 'tier'>>, patch: Partial<NewSession>): boolean {
  const moved = db.update(schema.sessions).set(patch).where(and(
    eq(schema.sessions.id, id),
    from.envState === undefined ? undefined : eq(schema.sessions.envState, from.envState),
    from.tier === undefined ? undefined : eq(schema.sessions.tier, from.tier),
  )).run().changes > 0
  if (moved) sessionChanged(id)
  return moved
}

// Silent: it runs on every proxied preview request and changes nothing the dashboard shows.
export function touchSessionPreview(id: number): void {
  db.update(schema.sessions).set({ previewLastSeen: new Date() }).where(eq(schema.sessions.id, id)).run()
}

// Closed is a display state, not a gate: dashboard follow-ups still land on it.
export function closeObjectlessSession(id: number): void {
  db.update(schema.sessions)
    .set({ status: 'closed', closedAt: new Date() })
    .where(and(eq(schema.sessions.id, id), isNull(schema.sessions.objectKind)))
    .run()
  sessionChanged(id)
}

export function deleteSession(id: number, tx: Executor = db): void {
  tx.delete(schema.sessions).where(eq(schema.sessions.id, id)).run()
}

export function deleteProjectSessions(projectId: number, tx: Executor = db): void {
  tx.delete(schema.sessions).where(eq(schema.sessions.projectId, projectId)).run()
}
