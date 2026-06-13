import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'

// DELETE /api/projects/:id → disconnect a project.
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
  }

  db.delete(schema.projects).where(eq(schema.projects.id, id)).run()
  return { ok: true }
})
