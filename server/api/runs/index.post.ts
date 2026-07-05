import { z } from 'zod'
import { db, schema } from '../../db'
import { getWorkflow } from '../../workflows'

// POST /api/runs → queue a workflow against one project. The dispatcher
// (server/plugins/dispatcher.ts) starts it as soon as a concurrency slot is
// free. Returns the created run row; the UI then polls GET /api/runs/:id.
const bodySchema = z.object({
  projectId: z.number().int(),
  workflow: z.string().min(1),
  // The branch to check out and run against; defaults to the repo's default.
  branch: z.string().min(1).optional(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid run request' })
  }

  if (!getWorkflow(result.data.workflow)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown workflow' })
  }

  const project = requireProject(result.data.projectId)

  const run = db
    .insert(schema.runs)
    .values({
      projectId: project.id,
      workflow: result.data.workflow,
      trigger: 'manual',
      branch: result.data.branch ?? project.defaultBranch,
    })
    .returning()
    .get()

  return run
})
