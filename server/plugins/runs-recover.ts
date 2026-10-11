import { handBackObject } from '../integrations/assignee'
import { getProject } from '../stores/projects'
import { getSessionRow } from '../stores/sessions'
import { appendRunLog, failInterruptedRuns } from '../stores/runs'
import { failInterruptedSteps } from '../stores/run-steps'
import { failInterruptedFollowups } from '../stores/followups'

export default defineNitroPlugin(() => {
  const interrupted = failInterruptedRuns('\n✗ Interrupted by a daemon restart\n')

  failInterruptedSteps('Interrupted by a daemon restart')

  failInterruptedFollowups('Interrupted by a daemon restart')

  for (const run of interrupted) {
    const session = getSessionRow(run.sessionId)
    const project = session && getProject(session.projectId)
    if (session && project) void handBackObject(session, run.id, project, text => appendRunLog(run.id, text))
  }
})
