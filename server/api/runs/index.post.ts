import { z } from 'zod'
import { publishStepsSchema } from '#server/workflows/schema'
import { dispatchRuns } from '#server/daemon/dispatcher'
import { emptyInputs, labelList } from '#server/utils/inputs'
import { resolveObjectSession } from '#server/utils/sessions'
import { requireProject } from '#server/stores/projects'
import { requireWorkflowRow } from '#server/stores/workflows'
import { createRun } from '#server/stores/runs'
import { defineEventHandler, readBody } from 'h3'
import { zodBadRequest } from '#server/utils/http'

const bodySchema = z.object({
  projectId: z.number().int(),
  workflowId: z.number().int(),
  branch: z.string().min(1).optional(),
  base: z.string().min(1).optional(),
  inputs: z.record(z.string(), z.string()).optional(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    zodBadRequest(result.error, 'Invalid run request')
  }

  const workflow = requireWorkflowRow(result.data.workflowId)

  const validated = publishStepsSchema.safeParse(workflow.draftSteps ?? workflow.steps)
  if (!validated.success) {
    zodBadRequest(validated.error, 'The workflow is not complete')
  }

  const project = requireProject(result.data.projectId)
  const inputs = result.data.inputs ?? {}

  const { session } = resolveObjectSession(project, null, result.data.branch ?? null, result.data.base ?? null)
  const run = createRun({
    projectId: project.id,
    sessionId: session.id,
    workflow: workflow.name,
    workflowId: workflow.id,
    trigger: 'manual',
    branch: session.branch ?? project.defaultBranch,
    inputs: { ...emptyInputs('manual'), ...inputs, labels: labelList(inputs.labels ?? '') },
    steps: validated.data,
  })

  dispatchRuns()

  return run
})
