import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { cancelFollowupWork } from '../../../daemon/followups'
import { appendLog, cancelRun } from '../../../daemon/runner'
import { handBackObject } from '../../../integrations/assignee'
import { getProject, getSessionRow } from '../../../utils/entities'
import { withRunSessionEnv } from '../../../utils/run-view'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)

  const cancelled = db
    .update(schema.runs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(eq(schema.runs.id, id), inArray(schema.runs.status, ['queued', 'running'])))
    .run()
  if (!cancelled.changes) {
    throw createError({ statusCode: 409, statusMessage: 'Run already finished' })
  }

  if (run.kind === 'mention') {
    cancelFollowupWork(run.sessionId, id)
  }
  else {
    cancelRun(id)
  }
  // A run that never started hands nothing back on its own, but it may have kept the session busy.
  if (run.status === 'queued') {
    const session = getSessionRow(run.sessionId)
    const project = session && getProject(session.projectId)
    if (session && project) void handBackObject(session, id, project, text => appendLog(id, text))
  }
  return withRunSessionEnv(requireRun(id))
})
