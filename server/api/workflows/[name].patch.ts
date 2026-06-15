import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { isBuiltin } from '../../workflows'
import { workflowInputSchema } from '../../workflows/schema'

// PATCH /api/workflows/:name → update a workflow. If the target is a built-in
// with no DB row yet, this writes an override row (built-in names can't be
// renamed — the override has to keep the name to shadow it). Pure DB workflows
// can be renamed (to a free, non-built-in name).
export default defineEventHandler(async (event) => {
  const target = decodeURIComponent(getRouterParam(event, 'name') ?? '')

  const result = workflowInputSchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid workflow' })
  }
  const data = result.data

  const row = db.select().from(schema.workflows).where(eq(schema.workflows.name, target)).get()

  // Nothing in the DB and not a built-in → there's nothing to edit.
  if (!row && !isBuiltin(target)) {
    throw createError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  const renaming = data.name !== target
  if (renaming) {
    if (isBuiltin(target)) {
      throw createError({ statusCode: 400, statusMessage: 'Built-in workflows cannot be renamed' })
    }
    if (isBuiltin(data.name) || db.select().from(schema.workflows).where(eq(schema.workflows.name, data.name)).get()) {
      throw createError({ statusCode: 409, statusMessage: 'A workflow with this name already exists' })
    }
  }

  // Built-in with no override yet → create the override row.
  if (!row) {
    return db.insert(schema.workflows).values(data).returning().get()
  }

  return db
    .update(schema.workflows)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(schema.workflows.id, row.id))
    .returning()
    .get()
})
