import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import type { NewWorkflowRow } from '../../db/schema'
import { publishStepsSchema, workflowPatchSchema } from '../../workflows/schema'

// PATCH /api/workflows/:id → partial update from the editor's autosaves and
// the enabled toggles. name/description apply directly to the row.
//
// draftSteps auto-promote: a save that passes the strict run validation IS
// the new live version (there is no separate publish action). Only an
// incomplete save is stored as a draft, leaving the last complete version in
// `steps` for automation to keep running.
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
  if (data.draftSteps !== undefined) {
    const strict = publishStepsSchema.safeParse(data.draftSteps)
    if (strict.success) {
      patch.steps = strict.data
      patch.draftSteps = null
      patch.publishedAt = new Date()
    }
    else {
      patch.draftSteps = data.draftSteps
    }
  }
  if (data.repliesEnabled !== undefined) patch.repliesEnabled = data.repliesEnabled
  if (data.enabled !== undefined) {
    // Triggers execute the live version; without one the switch has nothing
    // to turn on. (The editor gates this client-side, the list page relies
    // on this message.)
    if (data.enabled && !(patch.publishedAt ?? row.publishedAt)) {
      throw createError({ statusCode: 400, statusMessage: 'Finish the workflow before enabling automation' })
    }
    patch.enabled = data.enabled
  }

  return db
    .update(schema.workflows)
    .set(patch)
    .where(eq(schema.workflows.id, id))
    .returning()
    .get()
})
