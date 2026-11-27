import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, schema, type Executor } from '#server/db'
import type { NewSession, Project, Run, Session } from '#server/db/schema'
import type { SessionObject } from '#server/utils/sessions'
import { liveTopics } from '#shared/utils/live-topics'
import { emitTopics } from '#server/utils/live'
import { listSessionRunIds } from '#server/stores/runs'
import { findObjectRow } from '#server/stores/session-objects'

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
  const row = findObjectRow(projectId, object)
  return row && getSessionRow(row.sessionId)
}

export function sessionBase(session: Pick<Session, 'baseBranch'>, project: Pick<Project, 'defaultBranch'>): string {
  return session.baseBranch ?? project.defaultBranch
}

// A PR from the default branch into another base (main into release) must still never push the default branch.
export function isBaseBranch(branch: string, session: Pick<Session, 'baseBranch'>, project: Pick<Project, 'defaultBranch'>): boolean {
  return branch === sessionBase(session, project) || branch === project.defaultBranch
}

// The newest session working on `branch`; a base branch is nobody's work branch.
export function findBranchSession(project: Pick<Project, 'id' | 'defaultBranch'>, branch: string): Session | undefined {
  if (branch === project.defaultBranch) return undefined
  return db.select().from(schema.sessions)
    .where(and(
      eq(schema.sessions.projectId, project.id),
      eq(schema.sessions.branch, branch),
      or(isNull(schema.sessions.baseBranch), ne(schema.sessions.baseBranch, branch)),
    ))
    .orderBy(desc(schema.sessions.id))
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

export function listProjectSessionCounts() {
  const s = schema.sessions
  return db.select({
    projectId: s.projectId,
    open: sql<number>`coalesce(sum(${s.status} = 'open'), 0)`,
    live: sql<number>`coalesce(sum(${s.envState} = 'up' and ${s.tier} = 'preview'), 0)`,
    prs: sql<number>`coalesce(sum(${s.status} = 'open' and exists (select 1 from ${schema.runs} where ${schema.runs.sessionId} = ${s.id} and ${schema.runs.prUrl} is not null)), 0)`,
  }).from(s).groupBy(s.projectId).all()
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
export function moveSession(id: number, from: Session['envState'][], patch: Partial<NewSession>): boolean {
  const moved = db.update(schema.sessions).set(patch).where(and(
    eq(schema.sessions.id, id),
    inArray(schema.sessions.envState, from),
  )).run().changes > 0
  if (moved) sessionChanged(id)
  return moved
}

// Silent: it runs on every proxied preview request and changes nothing the dashboard shows.
export function touchSessionPreview(id: number): void {
  db.update(schema.sessions).set({ previewLastSeen: new Date() }).where(eq(schema.sessions.id, id)).run()
}

export function deleteSession(id: number, tx: Executor = db): void {
  tx.delete(schema.sessions).where(eq(schema.sessions.id, id)).run()
}

export function deleteProjectSessions(projectId: number, tx: Executor = db): void {
  tx.delete(schema.sessions).where(eq(schema.sessions.projectId, projectId)).run()
}
