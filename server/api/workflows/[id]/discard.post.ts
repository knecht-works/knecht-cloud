import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  requireWorkflowRow(id)

  return db
    .update(schema.workflows)
    .set({ draftSteps: null, updatedAt: new Date() })
    .where(eq(schema.workflows.id, id))
    .returning()
    .get()
})
