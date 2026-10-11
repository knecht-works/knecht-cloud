import { eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import { db, schema } from '../db'
import type { NewWorkflowRow, WorkflowRow } from '../db/schema'
import { clearStarterWorkflow } from './projects'
import { unlinkWorkflowRuns } from './runs'
import { deleteWorkflowTriggers } from './triggers'
import { liveTopics } from '../../shared/utils/live-topics'
import { emitTopics } from '../utils/live'

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
  const workflow = db.insert(schema.workflows).values(values).returning().get()
  emitTopics(liveTopics.workflows)
  return workflow
}

export function updateWorkflow(id: number, patch: Partial<NewWorkflowRow>): WorkflowRow | undefined {
  const workflow = db.update(schema.workflows)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.workflows.id, id))
    .returning()
    .get()
  emitTopics(liveTopics.workflows)
  return workflow
}

export function discardWorkflowDraft(id: number): WorkflowRow | undefined {
  return updateWorkflow(id, { draftSteps: null })
}

// FK actions are declarative only (PRAGMA foreign_keys is off): cascade explicitly.
export function deleteWorkflow(id: number): { deletedTriggers: number } {
  emitTopics(liveTopics.workflows)
  return db.transaction((tx) => {
    const deletedTriggers = deleteWorkflowTriggers(id, tx)
    unlinkWorkflowRuns(id, tx)
    clearStarterWorkflow(id, tx)
    tx.delete(schema.workflows).where(eq(schema.workflows.id, id)).run()
    return { deletedTriggers }
  })
}
