import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../../../db'

// GET /api/runs/:id/steps/:rowId → one step row's heavy fields (outputs and
// its slice of the run log). Fetched lazily when a timeline row is expanded;
// the list endpoint (steps.get.ts) stays light for polling.
export default defineEventHandler((event) => {
  const runId = requireIntParam(event)
  const rowId = requireIntParam(event, 'rowId')

  const row = db
    .select({
      id: schema.runSteps.id,
      params: schema.runSteps.params,
      outputs: schema.runSteps.outputs,
      log: schema.runSteps.log,
      error: schema.runSteps.error,
    })
    .from(schema.runSteps)
    .where(and(eq(schema.runSteps.id, rowId), eq(schema.runSteps.runId, runId)))
    .get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Step not found' })
  }
  return row
})
