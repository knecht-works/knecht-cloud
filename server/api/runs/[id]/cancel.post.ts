import { cancelFollowupWork } from '../../../daemon/followups'
import { cancelRun } from '../../../daemon/runner'
import { handBackObject } from '../../../integrations/assignee'
import { withRunSessionEnv } from '../../../utils/run-view'
import { getProject } from '../../../stores/projects'
import { getSessionRow } from '../../../stores/sessions'
import { requireRun, appendRunLog, finishActiveRun } from '../../../stores/runs'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)

  if (!finishActiveRun(id, 'cancelled')) {
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
    if (session && project) void handBackObject(session, id, project, text => appendRunLog(id, text))
  }
  return withRunSessionEnv(requireRun(id))
})
