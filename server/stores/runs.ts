import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, schema, type Executor } from '../db'
import type { NewRun, Project, Run } from '../db/schema'
import { liveTopics } from '../../shared/utils/live-topics'
import { emitTopics } from '../utils/live'

type RunStatus = Run['status']
type FinalStatus = 'success' | 'failed' | 'cancelled'

const ACTIVE: RunStatus[] = ['queued', 'running']

const runSessionColumns = {
  envState: schema.sessions.envState,
  previewHosts: schema.sessions.previewHosts,
  previewReady: schema.sessions.previewReady,
  previewPort: schema.sessions.previewPort,
  projectEnv: schema.projects.ddevEnv,
  projectDevServer: schema.projects.devServer,
  projectPreviewPort: schema.projects.previewPort,
  objectIntegration: schema.sessions.objectIntegration,
  objectKind: schema.sessions.objectKind,
  objectKey: schema.sessions.objectKey,
  objectTitle: schema.sessions.objectTitle,
  objectUrl: schema.sessions.objectUrl,
  sessionStatus: schema.sessions.status,
}

const runListColumns = {
  id: schema.runs.id,
  projectId: schema.runs.projectId,
  project: schema.projects.fullName,
  sessionId: schema.runs.sessionId,
  workflow: schema.runs.workflow,
  workflowId: schema.runs.workflowId,
  status: schema.runs.status,
  ...runSessionColumns,
  steps: schema.runs.steps,
  trigger: schema.runs.trigger,
  triggerId: schema.runs.triggerId,
  startedAt: schema.runs.startedAt,
  finishedAt: schema.runs.finishedAt,
  createdAt: schema.runs.createdAt,
}

export function getRun(id: number): Run | undefined {
  return db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()
}

export function requireRun(id: number): Run {
  const run = getRun(id)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  return run
}

export function getRunView(id: number) {
  return db
    .select({
      ...runListColumns,
      kind: schema.runs.kind,
      branch: schema.runs.branch,
      prUrl: schema.runs.prUrl,
      log: schema.runs.log,
    })
    .from(schema.runs)
    .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
    .innerJoin(schema.sessions, eq(schema.runs.sessionId, schema.sessions.id))
    .where(eq(schema.runs.id, id))
    .get()
}

export function listRunViews(projectId: number | undefined, limit: number) {
  return db
    .select(runListColumns)
    .from(schema.runs)
    .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
    .innerJoin(schema.sessions, eq(schema.runs.sessionId, schema.sessions.id))
    .where(projectId === undefined ? undefined : eq(schema.runs.projectId, projectId))
    .orderBy(desc(schema.runs.id))
    .limit(limit)
    .all()
}

export function listRunStats(since: Date) {
  return db
    .select({
      status: schema.runs.status,
      trigger: schema.runs.trigger,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
      createdAt: schema.runs.createdAt,
    })
    .from(schema.runs)
    .where(gte(schema.runs.createdAt, since))
    .all()
}

export function listSessionRunSummaries(sessionId: number) {
  return db.select({
    id: schema.runs.id,
    workflow: schema.runs.workflow,
    kind: schema.runs.kind,
    status: schema.runs.status,
    prUrl: schema.runs.prUrl,
    createdAt: schema.runs.createdAt,
    finishedAt: schema.runs.finishedAt,
  }).from(schema.runs)
    .where(eq(schema.runs.sessionId, sessionId))
    .orderBy(asc(schema.runs.id))
    .all()
}

export function latestSessionRun(sessionId: number): Run | undefined {
  return db.select().from(schema.runs)
    .where(eq(schema.runs.sessionId, sessionId))
    .orderBy(desc(schema.runs.id))
    .get()
}

export function latestSessionActor(sessionId: number): Run['actor'] {
  return db.select({ actor: schema.runs.actor })
    .from(schema.runs)
    .where(and(eq(schema.runs.sessionId, sessionId), isNotNull(schema.runs.actor)))
    .orderBy(desc(schema.runs.id))
    .get()?.actor ?? null
}

export function latestSessionPrUrl(sessionId: number): string | null {
  return db.select({ prUrl: schema.runs.prUrl })
    .from(schema.runs)
    .where(and(eq(schema.runs.sessionId, sessionId), isNotNull(schema.runs.prUrl)))
    .orderBy(desc(schema.runs.id))
    .get()?.prUrl ?? null
}

export function getRunningSessionRun(sessionId: number): Run | undefined {
  return db.select().from(schema.runs)
    .where(and(eq(schema.runs.sessionId, sessionId), eq(schema.runs.status, 'running')))
    .get()
}

export function sessionHasRuns(sessionId: number): boolean {
  return !!db.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.sessionId, sessionId)).get()
}

export function sessionHasActiveRun(sessionId: number): boolean {
  return !!db.select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.sessionId, sessionId), inArray(schema.runs.status, ACTIVE)))
    .get()
}

export function ranOnVersion(triggerId: number, sessionId: number, version: string): boolean {
  return !!db.select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.triggerId, triggerId), eq(schema.runs.sessionId, sessionId), eq(schema.runs.objectVersion, version)))
    .get()
}

export function listRunningRunSessionIds(): number[] {
  return db.select({ sessionId: schema.runs.sessionId })
    .from(schema.runs)
    .where(eq(schema.runs.status, 'running'))
    .all()
    .map(r => r.sessionId)
}

export function listRunSessionIds(runIds: number[]): number[] {
  if (!runIds.length) return []
  return db.select({ sessionId: schema.runs.sessionId })
    .from(schema.runs)
    .where(inArray(schema.runs.id, runIds))
    .all()
    .map(r => r.sessionId)
}

// A mention run is executed by its follow-up, so only workflow runs are dispatched.
export function listQueuedWorkflowRuns(): { run: Pick<Run, 'id' | 'sessionId'>, project: Project }[] {
  return db
    .select({
      run: { id: schema.runs.id, sessionId: schema.runs.sessionId },
      project: schema.projects,
    })
    .from(schema.runs)
    .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
    .where(and(eq(schema.runs.status, 'queued'), eq(schema.runs.kind, 'workflow')))
    .orderBy(asc(schema.runs.id))
    .all()
}

export function listRunningWorkflowRunIds(projectId: number): number[] {
  return db.select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.projectId, projectId), eq(schema.runs.kind, 'workflow'), eq(schema.runs.status, 'running')))
    .all()
    .map(r => r.id)
}

export function listSessionRunIds(sessionId: number): number[] {
  return db.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.sessionId, sessionId)).all().map(r => r.id)
}

export function listProjectRunIds(projectId: number, tx: Executor = db): number[] {
  return tx.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.projectId, projectId)).all().map(r => r.id)
}

// Cast to blob: sqlite's length() on TEXT counts characters while the dashboard cuts the log in bytes.
export function runLogBytes(runId: number): number {
  return db
    .select({ bytes: sql<number>`length(cast(${schema.runs.log} as blob))` })
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .get()?.bytes ?? 0
}

export function runsChanged(ids: number[]): void {
  emitTopics(liveTopics.runs, ...ids.map(liveTopics.run))
}

export function createRun(values: NewRun): Run {
  const run = db.insert(schema.runs).values(values).returning().get()
  runsChanged([run.id])
  return run
}

export function updateRun(id: number, patch: Partial<NewRun>): void {
  db.update(schema.runs).set(patch).where(eq(schema.runs.id, id)).run()
  runsChanged([id])
}

export function appendRunLog(runId: number, text: string): void {
  db.update(schema.runs)
    .set({ log: sql`${schema.runs.log} || ${text}` })
    .where(eq(schema.runs.id, runId))
    .run()
  emitTopics(liveTopics.run(runId))
}

// A cancel can land while the run sits queued; the claim must lose that race.
export function claimQueuedRun(id: number): boolean {
  const claimed = db.update(schema.runs)
    .set({ status: 'running', startedAt: new Date(), finishedAt: null })
    .where(and(eq(schema.runs.id, id), eq(schema.runs.status, 'queued')))
    .run()
    .changes > 0
  if (claimed) runsChanged([id])
  return claimed
}

export function startQueuedRun(id: number): void {
  db.update(schema.runs)
    .set({ status: 'running', startedAt: new Date() })
    .where(and(eq(schema.runs.id, id), eq(schema.runs.status, 'queued')))
    .run()
  runsChanged([id])
}

export function requeueRun(id: number): void {
  updateRun(id, { status: 'queued', finishedAt: null })
}

export function finishRun(id: number, status: FinalStatus): void {
  updateRun(id, { status, finishedAt: new Date() })
}

// Guarded so a user cancel, which flips the row first, is never overwritten.
export function finishActiveRun(id: number, status: FinalStatus): boolean {
  const finished = db.update(schema.runs)
    .set({ status, finishedAt: new Date() })
    .where(and(eq(schema.runs.id, id), inArray(schema.runs.status, ACTIVE)))
    .run()
    .changes > 0
  if (finished) runsChanged([id])
  return finished
}

export function cancelActiveMentionRuns(scope: { sessionId: number } | { runId: number }): void {
  const cancelled = db.update(schema.runs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(
      'runId' in scope ? eq(schema.runs.id, scope.runId) : eq(schema.runs.sessionId, scope.sessionId),
      eq(schema.runs.kind, 'mention'),
      inArray(schema.runs.status, ACTIVE),
    ))
    .returning({ id: schema.runs.id })
    .all()
  if (cancelled.length) runsChanged(cancelled.map(r => r.id))
}

export function failInterruptedRuns(note: string): Pick<Run, 'id' | 'sessionId'>[] {
  const failed = db.update(schema.runs)
    .set({ status: 'failed', finishedAt: new Date(), log: sql`${schema.runs.log} || ${note}` })
    .where(eq(schema.runs.status, 'running'))
    .returning({ id: schema.runs.id, sessionId: schema.runs.sessionId })
    .all()
  runsChanged(failed.map(r => r.id))
  return failed
}

export function unlinkWorkflowRuns(workflowId: number, tx: Executor = db): void {
  const unlinked = tx.update(schema.runs).set({ workflowId: null }).where(eq(schema.runs.workflowId, workflowId)).returning({ id: schema.runs.id }).all()
  runsChanged(unlinked.map(r => r.id))
}

export function deleteRun(id: number): void {
  db.delete(schema.runs).where(eq(schema.runs.id, id)).run()
  runsChanged([id])
}

export function deleteProjectRuns(projectId: number, tx: Executor = db): void {
  tx.delete(schema.runs).where(eq(schema.runs.projectId, projectId)).run()
  runsChanged([])
}
