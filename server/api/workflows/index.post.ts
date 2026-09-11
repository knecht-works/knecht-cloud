import { db, schema } from '../../db'
import { workflowCreateSchema } from '../../workflows/schema'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => undefined)) ?? {}
  const result = workflowCreateSchema.safeParse(body)
  if (!result.success) {
    zodBadRequest(result.error, 'Invalid workflow')
  }

  const name = uniqueWorkflowName(result.data.name ?? 'Untitled workflow')
  return db
    .insert(schema.workflows)
    .values({ name, description: result.data.description, steps: [], enabled: false })
    .returning()
    .get()
})
