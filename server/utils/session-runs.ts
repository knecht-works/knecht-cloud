import type { Project, Run, Session } from '../db/schema'
import { dispatchRuns } from '../daemon/dispatcher'
import { createRun, sessionHasRuns } from '../stores/runs'
import { emptyInputs } from './inputs'

export function queueSessionRun(project: Project, session: Session, preview: boolean): Run {
  const name = sessionHasRuns(session.id)
    ? 'Boot preview'
    : preview ? 'New Preview Session' : 'New Code Session'
  const run = createRun({
    projectId: project.id,
    sessionId: session.id,
    workflow: name,
    workflowId: null,
    trigger: 'manual',
    branch: session.branch ?? project.defaultBranch,
    inputs: emptyInputs('manual'),
    steps: preview ? [{ type: 'ddev-start', id: 'boot-preview' }] : [],
  })
  dispatchRuns()
  return run
}
