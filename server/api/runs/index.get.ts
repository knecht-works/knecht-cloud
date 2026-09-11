import { desc, eq } from 'drizzle-orm'
import { stepsInclude } from '../../../shared/utils/workflow'
import { db, schema } from '../../db'
import { runSessionColumns, withPreviewTarget } from '../../utils/run-view'

const LIST_LIMIT = 200

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

  return query.orderBy(desc(schema.runs.id)).limit(LIST_LIMIT).all()
    .map(({ steps, ...r }) => ({ ...withPreviewTarget(r), hasBootStep: stepsInclude(steps ?? [], 'ddev-start') }))
})
