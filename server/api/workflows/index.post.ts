import { db, schema } from '../../db'
import { workflowCreateSchema } from '../../workflows/schema'

// POST /api/workflows → create a workflow shell the editor opens immediately:
// a fresh row with a free name ("Untitled workflow", "Untitled workflow 2", …),
// no steps and nothing published yet. The editor autosaves drafts into it; a
// taken name gets a numeric suffix instead of failing the create.
export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => undefined)) ?? {}
  const result = workflowCreateSchema.safeParse(body)
  if (!result.success) {
    zodBadRequest(result.error, 'Invalid workflow')
  }

  const name = uniqueWorkflowName(result.data.name ?? 'Untitled workflow')
  return db
    .insert(schema.workflows)
    .values({ name, description: result.data.description, steps: [] })
    .returning()
    .get()
})
