import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'

// GET /api/runs/:id → a single run incl. its log, for the detail page's poll.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)

  const run = db
    .select({
      id: schema.runs.id,
      projectId: schema.runs.projectId,
      project: schema.projects.fullName,
      sessionId: schema.runs.sessionId,
      workflow: schema.runs.workflow,
      workflowId: schema.runs.workflowId,
      status: schema.runs.status,
      // Env fields come from the run's session (ADR 0006), flattened in under
      // their historical names so the dashboard keeps working unchanged.
      envState: schema.sessions.envState,
      previewHosts: schema.sessions.previewHosts,
      previewReady: schema.sessions.previewReady,
      // The session's object (issue/PR), so the run header can name the
      // thread the session works on. All null for one-shot sessions.
      objectKind: schema.sessions.objectKind,
      objectNumber: schema.sessions.objectNumber,
      objectTitle: schema.sessions.objectTitle,
      objectUrl: schema.sessions.objectUrl,
      sessionStatus: schema.sessions.status,
      trigger: schema.runs.trigger,
      triggerId: schema.runs.triggerId,
      branch: schema.runs.branch,
      prUrl: schema.runs.prUrl,
      log: schema.runs.log,
      steps: schema.runs.steps,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
      createdAt: schema.runs.createdAt,
    })
    .from(schema.runs)
    .innerJoin(schema.projects, eq(schema.runs.projectId, schema.projects.id))
    .innerJoin(schema.sessions, eq(schema.runs.sessionId, schema.sessions.id))
    .where(eq(schema.runs.id, id))
    .get()

  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }

  return run
})
