import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm'
import { db, schema, type Executor } from '../db'

export type NewRunStep = typeof schema.runSteps.$inferInsert

export function listRunSteps(runId: number) {
  return db
    .select({
      id: schema.runSteps.id,
      stepIndex: schema.runSteps.stepIndex,
      stepId: schema.runSteps.stepId,
      type: schema.runSteps.type,
      origin: schema.runSteps.origin,
      params: schema.runSteps.params,
      status: schema.runSteps.status,
      error: schema.runSteps.error,
      attempt: schema.runSteps.attempt,
      parentStepId: schema.runSteps.parentStepId,
      iteration: schema.runSteps.iteration,
      logStart: schema.runSteps.logStart,
      startedAt: schema.runSteps.startedAt,
      finishedAt: schema.runSteps.finishedAt,
    })
    .from(schema.runSteps)
    .where(eq(schema.runSteps.runId, runId))
    .orderBy(asc(schema.runSteps.id))
    .all()
}

// Follow-up rows appended after the run finished are not part of the workflow's steps.
export function listTopLevelWorkflowSteps(runId: number) {
  return db
    .select({ id: schema.runSteps.id, stepIndex: schema.runSteps.stepIndex, status: schema.runSteps.status })
    .from(schema.runSteps)
    .where(and(
      eq(schema.runSteps.runId, runId),
      isNull(schema.runSteps.parentStepId),
      eq(schema.runSteps.origin, 'workflow'),
    ))
    .orderBy(asc(schema.runSteps.id))
    .all()
}

export function listWorkflowStepOutputs(runId: number) {
  return db
    .select({ stepId: schema.runSteps.stepId, type: schema.runSteps.type, outputs: schema.runSteps.outputs })
    .from(schema.runSteps)
    .where(and(eq(schema.runSteps.runId, runId), eq(schema.runSteps.origin, 'workflow')))
    .orderBy(asc(schema.runSteps.id))
    .all()
}

export function lastSuccessfulSessionStep(sessionId: number, type: string): { params: Record<string, unknown> | null } | undefined {
  return db
    .select({ params: schema.runSteps.params })
    .from(schema.runSteps)
    .innerJoin(schema.runs, eq(schema.runSteps.runId, schema.runs.id))
    .where(and(
      eq(schema.runs.sessionId, sessionId),
      eq(schema.runSteps.type, type),
      eq(schema.runSteps.status, 'success'),
    ))
    .orderBy(desc(schema.runSteps.id))
    .get()
}

export function listRunIdsWithRunningSteps(): number[] {
  return db
    .select({ runId: schema.runSteps.runId })
    .from(schema.runSteps)
    .where(eq(schema.runSteps.status, 'running'))
    .all()
    .map(r => r.runId)
}

export function createRunStep(values: NewRunStep): number {
  return db.insert(schema.runSteps).values(values).returning({ id: schema.runSteps.id }).get().id
}

export function updateRunStep(id: number, patch: Partial<NewRunStep>): void {
  db.update(schema.runSteps).set(patch).where(eq(schema.runSteps.id, id)).run()
}

export function failInterruptedSteps(error: string): void {
  db.update(schema.runSteps)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(eq(schema.runSteps.status, 'running'))
    .run()
}

export function deleteWorkflowStepsFrom(runId: number, fromRowId: number): void {
  db.delete(schema.runSteps)
    .where(and(
      eq(schema.runSteps.runId, runId),
      gte(schema.runSteps.id, fromRowId),
      eq(schema.runSteps.origin, 'workflow'),
    ))
    .run()
}

export function deleteRunSteps(runIds: number[], tx: Executor = db): void {
  if (runIds.length) tx.delete(schema.runSteps).where(inArray(schema.runSteps.runId, runIds)).run()
}
