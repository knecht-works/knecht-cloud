import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { workflowInputSchema } from '../../workflows/schema'

// POST /api/workflows → create a new workflow. Names are unique.
export default defineEventHandler(async (event) => {
  const result = workflowInputSchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid workflow' })
  }
  const { name } = result.data

  const existing = db.select().from(schema.workflows).where(eq(schema.workflows.name, name)).get()
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'A workflow with this name already exists' })
  }

  return db.insert(schema.workflows).values(result.data).returning().get()
})
