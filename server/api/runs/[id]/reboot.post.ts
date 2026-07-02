import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { rebootEnv } from '../../../daemon/envs'

// POST /api/runs/:id/reboot → restart a run's idle-stopped environment
// (daemon/envs.ts owns the how). Returns the refreshed run row.
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
    throw createError({ statusCode: 409, statusMessage: 'No environment to reboot — re-run the workflow' })
  }

  await rebootEnv(id)

  return db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()
})
