import { and, desc, eq, isNotNull, lte } from 'drizzle-orm'
import { createError } from 'h3'
import { db, schema, type Executor } from '../db'
import type { NewTrigger, Trigger } from '../db/schema'
import { liveTopics } from '../../shared/utils/live-topics'
import { emitTopics } from '../utils/live'

export function requireTrigger(id: number): Trigger {
  const trigger = db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()
  if (!trigger) throw createError({ statusCode: 404, statusMessage: 'Trigger not found' })
  return trigger
}

export function listTriggers(): Trigger[] {
  return db.select().from(schema.triggers).orderBy(desc(schema.triggers.id)).all()
}

export function listActiveTriggers(source: Trigger['source']): Trigger[] {
  return db.select().from(schema.triggers)
    .where(and(eq(schema.triggers.source, source), eq(schema.triggers.active, true)))
    .all()
}

export function listDueScheduleTriggers(now: Date): Trigger[] {
  return db.select().from(schema.triggers)
    .where(and(
      eq(schema.triggers.source, 'schedule'),
      eq(schema.triggers.active, true),
      isNotNull(schema.triggers.nextFireAt),
      lte(schema.triggers.nextFireAt, now),
    ))
    .all()
}

export function createTrigger(values: NewTrigger): Trigger {
  const trigger = db.insert(schema.triggers).values(values).returning().get()
  emitTopics(liveTopics.triggers)
  return trigger
}

export function updateTrigger(id: number, patch: Partial<NewTrigger>): Trigger | undefined {
  const trigger = db.update(schema.triggers).set(patch).where(eq(schema.triggers.id, id)).returning().get()
  emitTopics(liveTopics.triggers)
  return trigger
}

export function setTriggerNextFire(id: number, nextFireAt: Date | null): void {
  db.update(schema.triggers).set({ nextFireAt }).where(eq(schema.triggers.id, id)).run()
  emitTopics(liveTopics.triggers)
}

export function recordTriggerFired(t: Trigger): void {
  db.update(schema.triggers)
    .set({ lastFiredAt: new Date(), firedCount: t.firedCount + 1, updatedAt: new Date() })
    .where(eq(schema.triggers.id, t.id))
    .run()
  emitTopics(liveTopics.triggers)
}

export function deleteTrigger(id: number): void {
  db.delete(schema.triggers).where(eq(schema.triggers.id, id)).run()
  emitTopics(liveTopics.triggers)
}

export function deleteWorkflowTriggers(workflowId: number, tx: Executor = db): number {
  emitTopics(liveTopics.triggers)
  return tx.delete(schema.triggers).where(eq(schema.triggers.workflowId, workflowId)).run().changes
}

export function removeProjectFromTriggers(projectId: number, tx: Executor = db): void {
  for (const t of tx.select().from(schema.triggers).all()) {
    if (!t.projectIds.includes(projectId)) continue
    tx.update(schema.triggers)
      .set({ projectIds: t.projectIds.filter(p => p !== projectId) })
      .where(eq(schema.triggers.id, t.id))
      .run()
  }
  emitTopics(liveTopics.triggers)
}
