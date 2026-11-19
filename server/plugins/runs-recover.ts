import { handBackObject } from '#server/integrations/assignee'
import { getProject } from '#server/stores/projects'
import { getSessionRow } from '#server/stores/sessions'
import { appendRunLog, clearPendingDiagnoses, failInterruptedRuns } from '#server/stores/runs'
import { failInterruptedSteps } from '#server/stores/run-steps'
import { failInterruptedFollowups } from '#server/stores/followups'
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin(() => {
  const interrupted = failInterruptedRuns('\n✗ Interrupted by a daemon restart\n')

  failInterruptedSteps('Interrupted by a daemon restart')

  failInterruptedFollowups('Interrupted by a daemon restart')

  clearPendingDiagnoses()

  for (const run of interrupted) {
    const session = getSessionRow(run.sessionId)
    const project = session && getProject(session.projectId)
    if (session && project) void handBackObject(session, run.id, project, text => appendRunLog(run.id, text))
  }
})
