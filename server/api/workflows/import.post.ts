import { parse } from 'yaml'
import { z } from 'zod'
import { createWorkflow, uniqueWorkflowName } from '#server/stores/workflows'
import { workflowDocumentSchema } from '#server/workflows/schema'
import { defineEventHandler, readBody, createError } from 'h3'
import { zodBadRequest } from '#server/utils/http'

const bodySchema = z.object({
  source: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: 'Missing file content' })
  }

  let doc: unknown
  try {
    doc = parse(body.data.source)
  }
  catch (e) {
    throw createError({ statusCode: 400, statusMessage: `Not valid YAML/JSON: ${(e as Error).message}` })
  }

  const result = workflowDocumentSchema.safeParse(doc)
  if (!result.success) {
    zodBadRequest(result.error, 'Invalid workflow')
  }

  const name = uniqueWorkflowName(result.data.name)

  return createWorkflow({ name, description: result.data.description, steps: result.data.steps, publishedAt: new Date() })
})
