import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { isBuiltin } from '../../workflows'

// DELETE /api/workflows/:name → remove a DB workflow. For a pure user workflow
// it's deleted outright; for a built-in override it reverts to the built-in
// ("Reset to default"). A built-in with no override has nothing to delete.
export default defineEventHandler((event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name') ?? '')

  const row = db.select().from(schema.workflows).where(eq(schema.workflows.name, name)).get()
  if (!row) {
    if (isBuiltin(name)) {
      throw createError({ statusCode: 400, statusMessage: 'Built-in workflow is already at its default' })
    }
    throw createError({ statusCode: 404, statusMessage: 'Workflow not found' })
  }

  db.delete(schema.workflows).where(eq(schema.workflows.id, row.id)).run()
  return { ok: true, revertedToBuiltin: isBuiltin(name) }
})
