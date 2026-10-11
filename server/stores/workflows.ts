import { eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import { db, schema } from '../db'
import type { NewWorkflowRow, WorkflowRow } from '../db/schema'
import { clearStarterWorkflow } from './projects'
import { deleteWorkflowTriggers } from './triggers'

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

export function listWorkflowRows(): WorkflowRow[] {
  return db.select().from(schema.workflows).all()
}

export function getWorkflowRows(ids: number[]): WorkflowRow[] {
  return ids.length ? db.select().from(schema.workflows).where(inArray(schema.workflows.id, ids)).all() : []
}

export function createWorkflow(values: NewWorkflowRow): WorkflowRow {
  return db.insert(schema.workflows).values(values).returning().get()
}

export function updateWorkflow(id: number, patch: Partial<NewWorkflowRow>): WorkflowRow | undefined {
  return db.update(schema.workflows)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.workflows.id, id))
    .returning()
    .get()
}

export function discardWorkflowDraft(id: number): WorkflowRow | undefined {
  return updateWorkflow(id, { draftSteps: null })
}

// FK actions are declarative only (PRAGMA foreign_keys is off): cascade explicitly.
export function deleteWorkflow(id: number): { deletedTriggers: number } {
  return db.transaction((tx) => {
    const deletedTriggers = deleteWorkflowTriggers(id, tx)
    tx.update(schema.runs).set({ workflowId: null }).where(eq(schema.runs.workflowId, id)).run()
    clearStarterWorkflow(id, tx)
    tx.delete(schema.workflows).where(eq(schema.workflows.id, id)).run()
    return { deletedTriggers }
  })
}
