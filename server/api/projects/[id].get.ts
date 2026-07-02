import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { backfillFrameworks } from '../../utils/framework'

// GET /api/projects/:id → a single project. Resolves the framework from GitHub
// on the fly (best-effort) if it isn't known yet.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
  }

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .get()

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  await backfillFrameworks([project])
  return project
})
