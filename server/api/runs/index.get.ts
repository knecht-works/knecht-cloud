import { desc, eq } from 'drizzle-orm'
import { stepsInclude } from '../../../shared/utils/workflow'
import { db, schema } from '../../db'
import { runSessionColumns, withPreviewTarget } from '../../utils/run-view'

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
      sessionId: schema.runs.sessionId,
      workflow: schema.runs.workflow,
      workflowId: schema.runs.workflowId,
      status: schema.runs.status,
      // Env + object fields come from the run's session (ADR 0006), flattened
      // in under their historical names so the dashboard keeps working
      // unchanged; the shared fragment keeps list and detail identical.
      ...runSessionColumns,
      steps: schema.runs.steps,
      trigger: schema.runs.trigger,
      triggerId: schema.runs.triggerId,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
      createdAt: schema.runs.createdAt,
    })
    .from(schema.runs)
    .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
    .innerJoin(schema.sessions, eq(schema.runs.sessionId, schema.sessions.id))
    .$dynamic()

  if (Number.isInteger(projectId)) {
    query = query.where(eq(schema.runs.projectId, projectId))
  }

  // The steps blob stays server-side; the list only says whether the run's
  // workflow boots a preview environment (drives the preview/mascot UI).
  return query.orderBy(desc(schema.runs.id)).limit(LIST_LIMIT).all()
    .map(({ steps, ...r }) => ({ ...withPreviewTarget(r), hasBootStep: stepsInclude(steps ?? [], 'ddev-start') }))
})
