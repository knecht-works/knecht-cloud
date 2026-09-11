import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project, Run, Session, Trigger, WorkflowRow } from '../db/schema'

export function getProject(id: number): Project | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()
}

export function requireProject(id: number): Project {
  const project = getProject(id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  return project
}

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

export function requireTrigger(id: number): Trigger {
  const trigger = db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()
  if (!trigger) throw createError({ statusCode: 404, statusMessage: 'Trigger not found' })
  return trigger
}

export function getWorkflowRow(id: number): WorkflowRow | undefined {
  return db.select().from(schema.workflows).where(eq(schema.workflows.id, id)).get()
}

export function requireWorkflowRow(id: number): WorkflowRow {
  const row = getWorkflowRow(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Workflow not found' })
  return row
}

export function getWorkflowRowByName(name: string): WorkflowRow | undefined {
  return db.select().from(schema.workflows).where(eq(schema.workflows.name, name)).get()
}

export function uniqueWorkflowName(base: string): string {
  let name = base
  for (let n = 2; getWorkflowRowByName(name); n++) {
    name = `${base} ${n}`
  }
  return name
}
