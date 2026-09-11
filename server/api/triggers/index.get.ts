import { desc } from 'drizzle-orm'
import { db, schema } from '../../db'
import { toSummaries, type TriggerSummary } from '../../utils/triggers'

export default defineEventHandler((): TriggerSummary[] => {
  const rows = db.select().from(schema.triggers).orderBy(desc(schema.triggers.id)).all()
  return toSummaries(rows)
})
