import { lt } from 'drizzle-orm'
import { db, schema } from '../db'

export type NewToolCall = typeof schema.toolCalls.$inferInsert

export function recordToolCall(values: NewToolCall): void {
  db.insert(schema.toolCalls).values(values).run()
}

export function deleteToolCallsBefore(cutoff: Date): number {
  return db.delete(schema.toolCalls).where(lt(schema.toolCalls.createdAt, cutoff)).run().changes
}
