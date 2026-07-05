import { parse } from 'yaml'
import { z } from 'zod'
import { db, schema } from '../../db'
import { workflowDocumentSchema } from '../../workflows/schema'

// POST /api/workflows/import → create a workflow from an exported (or
// hand-written) YAML/JSON document. Validation errors come back path-precise;
// a taken name gets a numeric suffix instead of failing the import.
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
    const issue = result.error.issues[0]
    const at = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    throw createError({ statusCode: 400, statusMessage: `Invalid workflow: ${at}${issue?.message ?? 'unknown error'}` })
  }

  // Imports never overwrite: an existing name gets `-2`, `-3`, … appended.
  let name = result.data.name
  for (let n = 2; getWorkflowRow(name); n++) {
    name = `${result.data.name}-${n}`
  }

  return db
    .insert(schema.workflows)
    .values({ name, description: result.data.description, steps: result.data.steps })
    .returning()
    .get()
})
