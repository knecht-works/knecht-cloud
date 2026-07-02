import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { workflowInputSchema } from '../../workflows/schema'

// PATCH /api/workflows/:name → update a workflow. Any workflow can be edited or
// renamed (to a free name); starters are ordinary rows once seeded.
export default defineEventHandler(async (event) => {
  const target = decodeURIComponent(getRouterParam(event, 'name') ?? '')

  const result = workflowInputSchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid workflow' })
  }
  const data = result.data

  const row = db.select().from(schema.workflows).where(eq(schema.workflows.name, target)).get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  const renaming = data.name !== target
  if (renaming && db.select().from(schema.workflows).where(eq(schema.workflows.name, data.name)).get()) {
    throw createError({ statusCode: 409, statusMessage: 'A workflow with this name already exists' })
  }

  // `enabled` is optional in the body (editor auto-saves omit it) — spreading
  // `data` leaves it untouched when absent and updates it when present.
  return db.transaction((tx) => {
    const updated = tx
      .update(schema.workflows)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.workflows.id, row.id))
      .returning()
      .get()

    // Workflows are referenced by NAME (triggers.workflow, runs.workflow), not
    // by id — a rename must carry those references along or they'd orphan.
    if (renaming) {
      tx.update(schema.triggers).set({ workflow: data.name }).where(eq(schema.triggers.workflow, target)).run()
      tx.update(schema.runs).set({ workflow: data.name }).where(eq(schema.runs.workflow, target)).run()
    }

    return updated
  })
})
