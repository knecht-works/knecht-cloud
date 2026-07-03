import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'

// DELETE /api/workflows/:name → remove a workflow. The name becomes
// unresolvable, so the triggers that reference it are removed too (or they'd
// fire into the void). Runs keep the name as historical record.
export default defineEventHandler((event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name') ?? '')

  const row = requireWorkflowRow(name)

  const orphanTriggers = db.select({ id: schema.triggers.id }).from(schema.triggers).where(eq(schema.triggers.workflow, name)).all()

  db.transaction((tx) => {
    tx.delete(schema.workflows).where(eq(schema.workflows.id, row.id)).run()
    if (orphanTriggers.length) {
      tx.delete(schema.triggers).where(eq(schema.triggers.workflow, name)).run()
    }
  })

  return { ok: true, deletedTriggers: orphanTriggers.length }
})
