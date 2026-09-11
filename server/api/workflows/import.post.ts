import { parse } from 'yaml'
import { z } from 'zod'
import { db, schema } from '../../db'
import { workflowDocumentSchema } from '../../workflows/schema'

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

  return db
    .insert(schema.workflows)
    .values({ name, description: result.data.description, steps: result.data.steps, publishedAt: new Date() })
    .returning()
    .get()
})
