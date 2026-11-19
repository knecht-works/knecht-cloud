import type { NewWorkflowRow } from '#server/db/schema'
import { updateWorkflow, requireWorkflowRow, getWorkflowRowByName } from '#server/stores/workflows'
import { publishStepsSchema, workflowPatchSchema } from '#server/workflows/schema'
import { defineEventHandler, readBody, createError } from 'h3'
import { requireIntParam, zodBadRequest } from '#server/utils/http'

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

  const patch: Partial<NewWorkflowRow> = {}
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
  if (data.freshContext !== undefined) patch.freshContext = data.freshContext
  if (data.enabled !== undefined) {
    // The list page relies on this message; the editor gates it client-side.
    if (data.enabled && !(patch.publishedAt ?? row.publishedAt)) {
      throw createError({ statusCode: 400, statusMessage: 'Finish the workflow before enabling automation' })
    }
    patch.enabled = data.enabled
  }

  return updateWorkflow(id, patch)
})
