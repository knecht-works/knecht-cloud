import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../../db'

// The list/poll endpoints only ever show recent history; the cap keeps the
// synchronous sqlite read bounded as runs accumulate.
const LIST_LIMIT = 200

// GET /api/runs[?projectId=] → recent runs with their project's full name,
// newest first. The log blob is omitted from the list (fetched per-run on the
// detail page).
export default defineEventHandler((event) => {
  const projectId = Number(getQuery(event).projectId)

  let query = db
    .select({
      id: schema.runs.id,
      projectId: schema.runs.projectId,
      project: schema.projects.fullName,
      workflow: schema.runs.workflow,
      status: schema.runs.status,
      envState: schema.runs.envState,
      previewHosts: schema.runs.previewHosts,
      previewReady: schema.runs.previewReady,
      trigger: schema.runs.trigger,
      triggerId: schema.runs.triggerId,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
      createdAt: schema.runs.createdAt,
    })
    .from(schema.runs)
    .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
    .$dynamic()

  if (Number.isInteger(projectId)) {
    query = query.where(eq(schema.runs.projectId, projectId))
  }

  return query.orderBy(desc(schema.runs.id)).limit(LIST_LIMIT).all()
})
