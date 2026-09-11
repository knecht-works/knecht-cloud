import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  requireTrigger(id)

  db.delete(schema.triggers).where(eq(schema.triggers.id, id)).run()
  return { ok: true }
})
