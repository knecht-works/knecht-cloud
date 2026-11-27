import { cancelFollowupWork } from '#server/daemon/followups'
import { cancelRun } from '#server/daemon/runner'
import { cancelOperation } from '#server/daemon/session-env'
import { handBackObject } from '#server/integrations/assignee'
import { withRunSessionEnv } from '#server/utils/run-view'
import { getProject } from '#server/stores/projects'
import { getSessionRow } from '#server/stores/sessions'
import { requireRun, appendRunLog, finishActiveRun } from '#server/stores/runs'
import { defineEventHandler, createError } from 'h3'
import { requireIntParam } from '#server/utils/http'

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
    // The restore or reboot the run waits for. A queued run waits for none: the operation belongs to whatever runs.
    if (run.status === 'running') cancelOperation(run.sessionId)
  }
  // A run that never started hands nothing back on its own, but it may have kept the session busy.
  if (run.status === 'queued') {
    const session = getSessionRow(run.sessionId)
    const project = session && getProject(session.projectId)
    if (session && project) void handBackObject(session, id, project, text => appendRunLog(id, text))
  }
  return withRunSessionEnv(requireRun(id))
})
