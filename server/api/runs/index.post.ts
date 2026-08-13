import { z } from 'zod'
import { db, schema } from '../../db'
import { publishStepsSchema } from '../../workflows/schema'
import { dispatchRuns } from '../../daemon/dispatcher'

// POST /api/runs → queue a workflow against one project. The dispatcher
// (server/plugins/dispatcher.ts) starts it as soon as a concurrency slot is
// free. Returns the created run row; the UI then polls GET /api/runs/:id.
//
// Manual runs (this route) execute the workflow's CURRENT state (the draft,
// falling back to the published steps), strict-validated here and pinned onto
// the run row. Only automated trigger fires use the published snapshot.
const bodySchema = z.object({
  projectId: z.number().int(),
  workflowId: z.number().int(),
  // The branch to check out and run against; defaults to the repo's default.
  branch: z.string().min(1).optional(),
  // Mock trigger-event data ({{ inputs.* }}): lets a manual/test run exercise
  // a workflow that normally gets these from a trigger.
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

  const run = db
    .insert(schema.runs)
    .values({
      projectId: project.id,
      workflow: workflow.name,
      workflowId: workflow.id,
      trigger: 'manual',
      branch: result.data.branch ?? project.defaultBranch,
      inputs: result.data.inputs ?? null,
      steps: validated.data,
    })
    .returning()
    .get()

  dispatchRuns()

  return run
})
