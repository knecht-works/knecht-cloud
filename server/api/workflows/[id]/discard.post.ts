import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'

// POST /api/workflows/:id/discard → drop the draft; the editor snaps back to
// the published version.
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
