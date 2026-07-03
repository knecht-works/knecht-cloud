import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'

// DELETE /api/triggers/:id → remove a trigger. Existing runs it started are kept.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  requireTrigger(id)

  db.delete(schema.triggers).where(eq(schema.triggers.id, id)).run()
  return { ok: true }
})
