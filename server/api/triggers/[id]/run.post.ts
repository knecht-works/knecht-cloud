import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { fireTrigger } from '../../../utils/triggers'

// POST /api/triggers/:id/run → fire a trigger now. Used to run a manual trigger
// and to test a schedule/github one from the UI. Runs authenticate via the
// GitHub App, so no session credential is involved.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid trigger id' })
  }

  const row = db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger not found' })
  }

  const runIds = fireTrigger(row)
  return { ok: true, runIds }
})
