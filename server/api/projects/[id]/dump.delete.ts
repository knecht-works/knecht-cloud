import { rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'

// DELETE /api/projects/:id/dump → remove the uploaded DB dump.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const project = requireProject(id)

  if (project.dbDumpPath) {
    try {
      rmSync(project.dbDumpPath)
    }
    catch {
      // Already gone: clear the reference anyway.
    }
  }

  return db
    .update(schema.projects)
    .set({ dbDumpPath: null, dbImported: false, updatedAt: new Date() })
    .where(eq(schema.projects.id, id))
    .returning()
    .get()
})
