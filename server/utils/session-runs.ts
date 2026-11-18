import type { Project, Run, Session } from '../db/schema'
import { dispatchRuns } from '../daemon/dispatcher'
import { createRun } from '../stores/runs'
import { emptyInputs } from './inputs'

export function queueSessionRun(project: Project, session: Session, preview: boolean): Run {
  const run = createRun({
    projectId: project.id,
    sessionId: session.id,
    workflow: preview ? 'Boot preview' : 'Checkout',
    workflowId: null,
    trigger: 'manual',
    branch: session.branch ?? project.defaultBranch,
    inputs: emptyInputs('manual'),
    steps: preview ? [{ type: 'ddev-start', id: 'boot-preview' }] : [],
  })
  dispatchRuns()
  return run
}
