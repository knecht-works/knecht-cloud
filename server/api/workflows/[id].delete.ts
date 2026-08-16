import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'

// DELETE /api/workflows/:id → remove a workflow. Its triggers go with it (they
// would fire into the void); runs survive as history under the workflow's name
// with their workflow_id nulled. Both happen explicitly here: the schema's FK
// actions are declarative only (PRAGMA foreign_keys is off).
export default defineEventHandler((event) => {
  const id = requireIntParam(event)

  requireWorkflowRow(id)

  const orphanTriggers = db.select({ id: schema.triggers.id }).from(schema.triggers).where(eq(schema.triggers.workflowId, id)).all()

  db.transaction((tx) => {
    if (orphanTriggers.length) {
      tx.delete(schema.triggers).where(eq(schema.triggers.workflowId, id)).run()
    }
    tx.update(schema.runs).set({ workflowId: null }).where(eq(schema.runs.workflowId, id)).run()
    // A project pointing at it as its mention starter loses the pointer (the
    // next mention gets the setup hint again).
    tx.update(schema.projects).set({ starterWorkflowId: null }).where(eq(schema.projects.starterWorkflowId, id)).run()
    tx.delete(schema.workflows).where(eq(schema.workflows.id, id)).run()
  })

  return { ok: true, deletedTriggers: orphanTriggers.length }
})
