import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import { getWorkflow } from '../../workflows'
import { startRun } from '../../daemon/runner'

// POST /api/runs → start a workflow against one project. Repo credentials come
// from the GitHub App (server/utils/github-app.ts), minted inside the runner.
// Returns the created run row; the UI then polls GET /api/runs/:id.
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

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, result.data.projectId))
    .get()
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

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

  startRun(run.id, project)

  return run
})
