import { rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'

// DELETE /api/projects/:id/dump → remove the uploaded DB dump.
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
  }

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  if (project.dbDumpPath) {
    try {
      rmSync(project.dbDumpPath)
    }
    catch {
      // Already gone — clear the reference anyway.
    }
  }

  return db
    .update(schema.projects)
    .set({ dbDumpPath: null, updatedAt: new Date() })
    .where(eq(schema.projects.id, id))
    .returning()
    .get()
})
