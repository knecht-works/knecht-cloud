import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import { getWorkflow } from '../../workflows'
import { startRun } from '../../daemon/runner'

// POST /api/runs → start a workflow against one project. The OAuth token is read
// from the session and injected into the run (tech-stack.md §4) as the clone
// credential. Returns the created run row; the UI then polls GET /api/runs/:id.
const bodySchema = z.object({
  projectId: z.number().int(),
  workflow: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const { secure } = await requireUserSession(event)
  if (!secure?.githubToken) {
    throw createError({ statusCode: 401, statusMessage: 'No GitHub token in session' })
  }

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
    .values({ projectId: project.id, workflow: result.data.workflow })
    .returning()
    .get()

  startRun(run.id, project, secure.githubToken)

  return run
})
