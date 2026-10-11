import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Run, Session } from '../db/schema'

export function getRun(id: number): Run | undefined {
  return db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()
}

export function requireRun(id: number): Run {
  const run = getRun(id)
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  return run
}

export function getSessionRow(id: number): Session | undefined {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get()
}

export function requireSession(id: number): Session {
  const session = getSessionRow(id)
  if (!session) throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  return session
}

export function requireRunSession(run: Run): Session {
  return requireSession(run.sessionId)
}
