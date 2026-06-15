import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'

// PATCH /api/projects/:id → update the editable per-project config.
const bodySchema = z.object({
  envVars: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional(),
})

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
  }

  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid project config' })
  }

  const updated = db
    .update(schema.projects)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(schema.projects.id, id))
    .returning()
    .get()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  return updated
})
