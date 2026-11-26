import { publishStepsSchema } from '#server/workflows/schema'
import { dispatchRuns } from '#server/daemon/dispatcher'
import { stopRunProcesses } from '#server/daemon/session-sandbox'
import { isRunExecuting } from '#server/daemon/runner'
import { sessionHasActiveWork } from '#server/utils/sessions'
import { requireProject } from '#server/stores/projects'
import { requireSession } from '#server/stores/sessions'
import { requireWorkflowRow } from '#server/stores/workflows'
import { createRun, requireRun } from '#server/stores/runs'
import { defineEventHandler, createError } from 'h3'
import { requireIntParam, zodBadRequest } from '#server/utils/http'

export default defineEventHandler(async (event) => {
  const run = requireRun(requireIntParam(event))
  if (run.status !== 'failed' && run.status !== 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'Only failed or cancelled runs can be run again' })
  }
  if (run.kind === 'mention') {
    throw createError({ statusCode: 409, statusMessage: 'A mention run cannot be run again. Mention Knecht on the thread again instead.' })
  }
  if (!run.workflowId) {
    throw createError({ statusCode: 409, statusMessage: 'The workflow was deleted' })
  }
  const workflow = requireWorkflowRow(run.workflowId)
  const validated = publishStepsSchema.safeParse(workflow.draftSteps ?? workflow.steps)
  if (!validated.success) {
    zodBadRequest(validated.error, 'The workflow is not complete')
  }

  const project = requireProject(run.projectId)
  const session = requireSession(run.sessionId)
  const refuseActiveWork = () => {
    if (sessionHasActiveWork(session.id)) {
      throw createError({ statusCode: 409, statusMessage: 'Something is running in this session. Wait for it to finish.' })
    }
  }
  // Checked first: a follow-up of this run carries the same tag, and its commands must survive a refusal.
  refuseActiveWork()
  if (!await stopRunProcesses(session.id, run.id)) {
    throw createError({ statusCode: 409, statusMessage: 'A command of the previous attempt is still stopping. Try again in a moment.' })
  }
  if (isRunExecuting(run.id)) {
    throw createError({ statusCode: 409, statusMessage: 'The previous attempt is still stopping. Try again in a moment.' })
  }
  // Again after the await, so nothing can start between this check and createRun.
  refuseActiveWork()

  const again = createRun({
    projectId: project.id,
    sessionId: session.id,
    workflow: workflow.name,
    workflowId: workflow.id,
    title: run.title,
    trigger: 'manual',
    objectId: run.objectId,
    actor: run.actor,
    branch: session.branch ?? project.defaultBranch,
    inputs: run.inputs,
    steps: validated.data,
    resetCheckout: true,
    startSha: run.startSha,
    endSha: run.endSha,
  })

  dispatchRuns()

  return again
})
