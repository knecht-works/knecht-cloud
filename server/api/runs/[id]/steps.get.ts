import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../../../db'

// GET /api/runs/:id/steps → the run's per-step execution records, in execution
// order — drives the step timeline on the run detail page (polled while live).
export default defineEventHandler((event) => {
  const id = requireIntParam(event)

  return db
    .select({
      id: schema.runSteps.id,
      stepIndex: schema.runSteps.stepIndex,
      stepId: schema.runSteps.stepId,
      type: schema.runSteps.type,
      status: schema.runSteps.status,
      error: schema.runSteps.error,
      attempt: schema.runSteps.attempt,
      parentStepId: schema.runSteps.parentStepId,
      iteration: schema.runSteps.iteration,
      startedAt: schema.runSteps.startedAt,
      finishedAt: schema.runSteps.finishedAt,
    })
    .from(schema.runSteps)
    .where(eq(schema.runSteps.runId, id))
    .orderBy(asc(schema.runSteps.id))
    .all()
})
