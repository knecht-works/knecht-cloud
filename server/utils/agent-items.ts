import { eq, max } from 'drizzle-orm'
import { db, schema } from '../db'
import type { TranscriptItem, TranscriptSink } from '../daemon/agent'
import { emitItem } from './transcript'

// Writes each item as it arrives and pushes it to the live chat.
export function transcriptSink(sessionId: number, followupId: number): TranscriptSink {
  const rows = new Map<string, number>()
  const last = db.select({ value: max(schema.agentItems.seq) }).from(schema.agentItems).where(eq(schema.agentItems.followupId, followupId)).get()
  let seq = (last?.value ?? -1) + 1
  return {
    item(item: TranscriptItem) {
      const { key, ...fields } = item
      const id = rows.get(key)
      const row = id !== undefined
        ? db.update(schema.agentItems).set(fields).where(eq(schema.agentItems.id, id)).returning().get()
        : db.insert(schema.agentItems).values({ sessionId, followupId, seq: seq++, ...fields }).returning().get()
      if (!row) return
      rows.set(key, row.id)
      emitItem(row)
    },
    end() {},
  }
}
