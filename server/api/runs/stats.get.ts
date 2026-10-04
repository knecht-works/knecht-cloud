import { gte } from 'drizzle-orm'
import { db, schema } from '../../db'

// Two 14-day windows plus a day of slack for the client's timezone.
const WINDOW_DAYS = 29

export default defineEventHandler(() => {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  return db
    .select({
      status: schema.runs.status,
      trigger: schema.runs.trigger,
      startedAt: schema.runs.startedAt,
      finishedAt: schema.runs.finishedAt,
      createdAt: schema.runs.createdAt,
    })
    .from(schema.runs)
    .where(gte(schema.runs.createdAt, since))
    .all()
})
