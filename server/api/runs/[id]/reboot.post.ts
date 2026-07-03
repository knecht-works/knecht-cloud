import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { rebootEnv, rehydrateEnv } from '../../../daemon/envs'

// POST /api/runs/:id/reboot → bring a run's environment back: a stopped one
// reboots in seconds, an archived one is restored exactly from its archive
// (takes minutes). daemon/envs.ts owns the how. Returns the refreshed run row.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
  }

  const run = db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()
  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }
  if (run.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'No environment left. Run the workflow again.' })
  }

  if (run.envState === 'archived') {
    await rehydrateEnv(id)
  }
  else {
    await rebootEnv(id)
  }

  return db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()
})
