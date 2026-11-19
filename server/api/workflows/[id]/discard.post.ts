import { discardWorkflowDraft, requireWorkflowRow } from '#server/stores/workflows'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  requireWorkflowRow(id)

  return discardWorkflowDraft(id)
})
