import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'

// GET /api/runs/:id → a single run incl. its log, for the detail page's poll.
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
  }

  const run = db
    .select({
      id: schema.runs.id,
      projectId: schema.runs.projectId,
      project: schema.projects.fullName,
      workflow: schema.runs.workflow,
      status: schema.runs.status,
      envState: schema.runs.envState,
      log: schema.runs.log,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
    })
    .from(schema.runs)
    .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
    .where(eq(schema.runs.id, id))
    .get()

  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }

  return run
})
