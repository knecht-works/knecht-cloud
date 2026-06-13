import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'

// POST /api/projects/:id/dump → upload a DB dump (multipart). Stored on disk so a
// later `ddev import-db --file=<dbDumpPath>` can stream it into the project.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
  }

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  const form = await readMultipartFormData(event)
  const file = form?.find(part => part.name === 'file' && part.filename)
  if (!file?.filename) {
    throw createError({ statusCode: 400, statusMessage: 'No file provided' })
  }

  const filePath = join(projectDumpDir(id), sanitizeFilename(file.filename))
  writeFileSync(filePath, file.data)

  return db
    .update(schema.projects)
    .set({ dbDumpPath: filePath, dbImported: false, updatedAt: new Date() })
    .where(eq(schema.projects.id, id))
    .returning()
    .get()
})
