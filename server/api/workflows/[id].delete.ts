import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'

// FK actions are declarative only (PRAGMA foreign_keys is off): cascade explicitly.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)

  requireWorkflowRow(id)

  const orphanTriggers = db.select({ id: schema.triggers.id }).from(schema.triggers).where(eq(schema.triggers.workflowId, id)).all()

  db.transaction((tx) => {
    if (orphanTriggers.length) {
      tx.delete(schema.triggers).where(eq(schema.triggers.workflowId, id)).run()
    }
    tx.update(schema.runs).set({ workflowId: null }).where(eq(schema.runs.workflowId, id)).run()
    tx.update(schema.projects).set({ starterWorkflowId: null }).where(eq(schema.projects.starterWorkflowId, id)).run()
    tx.delete(schema.workflows).where(eq(schema.workflows.id, id)).run()
  })

  return { ok: true, deletedTriggers: orphanTriggers.length }
})
