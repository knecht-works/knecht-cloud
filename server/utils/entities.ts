import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project, Run, Trigger, WorkflowRow } from '../db/schema'

// Row lookups shared by the API routes and the daemon. The `get*` variants
// return undefined for a missing row (delete routes stay idempotent); the
// `require*` variants fail the request with a 404 instead.

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

export function requireTrigger(id: number): Trigger {
  const trigger = db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()
  if (!trigger) throw createError({ statusCode: 404, statusMessage: 'Trigger not found' })
  return trigger
}

// Named `*Row` to stay clear of server/workflows' getWorkflow (the parsed
// workflow definition) — this is the raw DB row the CRUD routes edit.
export function getWorkflowRow(name: string): WorkflowRow | undefined {
  return db.select().from(schema.workflows).where(eq(schema.workflows.name, name)).get()
}

export function requireWorkflowRow(name: string): WorkflowRow {
  const row = getWorkflowRow(name)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Workflow not found' })
  return row
}
