import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'

// DELETE /api/triggers/:id → remove a trigger. Existing runs it started are kept.
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid trigger id' })
  }

  const row = db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger not found' })
  }

  db.delete(schema.triggers).where(eq(schema.triggers.id, id)).run()
  return { ok: true }
})
