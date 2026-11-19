import { createWorkflow, uniqueWorkflowName } from '#server/stores/workflows'
import { workflowCreateSchema } from '#server/workflows/schema'
import { defineEventHandler, readBody } from 'h3'
import { zodBadRequest } from '#server/utils/http'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => undefined)) ?? {}
  const result = workflowCreateSchema.safeParse(body)
  if (!result.success) {
    zodBadRequest(result.error, 'Invalid workflow')
  }

  const name = uniqueWorkflowName(result.data.name ?? 'Untitled workflow')
  return createWorkflow({ name, description: result.data.description, steps: [], enabled: false })
})
