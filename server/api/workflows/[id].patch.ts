import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import type { NewWorkflowRow } from '../../db/schema'
import { workflowPatchSchema } from '../../workflows/schema'

// PATCH /api/workflows/:id → partial update from the editor's autosaves and
// the enabled toggles. name/description/enabled apply directly to the row;
// draftSteps is the loosely validated working copy. A draft that equals the
// published steps is stored as NULL, keeping the invariant "draftSteps set
// means unpublished changes exist".
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)

  const result = workflowPatchSchema.safeParse(await readBody(event))
  if (!result.success) {
    zodBadRequest(result.error, 'Invalid workflow update')
  }
  const data = result.data

  const row = requireWorkflowRow(id)

  if (data.name !== undefined && data.name !== row.name && getWorkflowRowByName(data.name)) {
    throw createError({ statusCode: 409, statusMessage: 'A workflow with this name already exists' })
  }

  const patch: Partial<NewWorkflowRow> = { updatedAt: new Date() }
  if (data.name !== undefined) patch.name = data.name
  if (data.description !== undefined) patch.description = data.description
  if (data.enabled !== undefined) patch.enabled = data.enabled
  if (data.draftSteps !== undefined) {
    patch.draftSteps = JSON.stringify(data.draftSteps) === JSON.stringify(row.steps) ? null : data.draftSteps
  }

  return db
    .update(schema.workflows)
    .set(patch)
    .where(eq(schema.workflows.id, id))
    .returning()
    .get()
})
