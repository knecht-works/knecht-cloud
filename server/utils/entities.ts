import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Run } from '../db/schema'

export function getRun(id: number): Run | undefined {
  return db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()
}

export function requireRun(id: number): Run {
  const run = getRun(id)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  return run
}
