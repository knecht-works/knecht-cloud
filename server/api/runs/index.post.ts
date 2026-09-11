import { z } from 'zod'
import { db, schema } from '../../db'
import { publishStepsSchema } from '../../workflows/schema'
import { dispatchRuns } from '../../daemon/dispatcher'
import { resolveSession } from '../../utils/sessions'

const bodySchema = z.object({
  projectId: z.number().int(),
  workflowId: z.number().int(),
  branch: z.string().min(1).optional(),
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

  const session = resolveSession(project, null, result.data.branch ?? null)
  const run = db
    .insert(schema.runs)
    .values({
      projectId: project.id,
      sessionId: session.id,
      workflow: workflow.name,
      workflowId: workflow.id,
      trigger: 'manual',
      branch: session.branch ?? project.defaultBranch,
      inputs: result.data.inputs ?? null,
      steps: validated.data,
    })
    .returning()
    .get()

  dispatchRuns()

  return run
})
