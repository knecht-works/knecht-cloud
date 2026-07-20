import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'

// PATCH /api/projects/:id → update the editable per-project config.
const bodySchema = z.object({
  envVars: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional(),
  // The branch runs check out and open PRs against. New runs pick it up on
  // their next checkout; the shared base clone just fetches the new branch.
  defaultBranch: z.string().min(1).optional(),
  // How preview URLs reach the browser (see server/db/schema.ts). Applies to
  // runs started after the change; existing runs keep their pinned mode.
  urlMode: z.enum(['env', 'rewrite']).optional(),
})

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)

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
