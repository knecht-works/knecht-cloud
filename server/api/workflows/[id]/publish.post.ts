import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { publishStepsSchema } from '../../../workflows/schema'

// POST /api/workflows/:id/publish → promote the draft to the published
// version. This is the strict validation point: the draft (or, with no draft
// pending, the current steps, i.e. a re-publish) must be complete and
// runnable. From here on triggers and production runs execute this version.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const row = requireWorkflowRow(id)

  const result = publishStepsSchema.safeParse(row.draftSteps ?? row.steps)
  if (!result.success) {
    zodBadRequest(result.error, 'The workflow is not complete')
  }

  return db
    .update(schema.workflows)
    .set({ steps: result.data, draftSteps: null, publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.workflows.id, id))
    .returning()
    .get()
})
