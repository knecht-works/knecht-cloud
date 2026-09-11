import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { projectDetectedEnv, resolveEnv } from '#shared/utils/env-spec'
import { db, schema } from '../../../db'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const project = requireProject(id)
  if (!resolveEnv(projectDetectedEnv(project.ddevEnv), project).hasDb.value) {
    throw createError({ statusCode: 422, statusMessage: 'This environment has no database container.' })
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
