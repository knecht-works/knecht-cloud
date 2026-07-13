import { and, asc, eq } from 'drizzle-orm'
import { db, schema } from '../../../db'

// GET /api/runs/:id/followups → the run's follow-ups in send order, each with
// the agent's reply (the outputs.text of its run_steps row). Drives the chat
// on the run detail page: prompt as the user message, reply as the assistant
// message, and the composer state (locked while one is queued or running).
export default defineEventHandler((event) => {
  const id = requireIntParam(event)

  const rows = db
    .select({
      id: schema.followups.id,
      prompt: schema.followups.prompt,
      push: schema.followups.push,
      requestedBy: schema.followups.requestedBy,
      status: schema.followups.status,
      error: schema.followups.error,
      createdAt: schema.followups.createdAt,
      startedAt: schema.followups.startedAt,
      finishedAt: schema.followups.finishedAt,
    })
    .from(schema.followups)
    .where(eq(schema.followups.runId, id))
    .orderBy(asc(schema.followups.id))
    .all()
  if (!rows.length) return []

  const steps = db
    .select({ stepId: schema.runSteps.stepId, outputs: schema.runSteps.outputs })
    .from(schema.runSteps)
    .where(and(eq(schema.runSteps.runId, id), eq(schema.runSteps.origin, 'followup')))
    .all()
  const outputsByStepId = new Map(steps.map(s => [s.stepId, s.outputs]))

  return rows.map((f) => {
    const text = outputsByStepId.get(`followup-${f.id}`)?.text
    return { ...f, response: typeof text === 'string' && text.trim() ? text : null }
  })
})
