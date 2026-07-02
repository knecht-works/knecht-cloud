import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../../db'

// GET /api/runs → recent runs with their project's full name, newest first.
// The log blob is omitted from the list (fetched per-run on the detail page).
export default defineEventHandler(() => {
  return db
    .select({
      id: schema.runs.id,
      projectId: schema.runs.projectId,
      project: schema.projects.fullName,
      workflow: schema.runs.workflow,
      status: schema.runs.status,
      envState: schema.runs.envState,
      previewHosts: schema.runs.previewHosts,
      trigger: schema.runs.trigger,
      triggerId: schema.runs.triggerId,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
      createdAt: schema.runs.createdAt,
    })
    .from(schema.runs)
    .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
    .orderBy(desc(schema.runs.id))
    .all()
})
