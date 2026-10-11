import type { TranscriptItem, TranscriptSink } from '../daemon/agent'
import { createAgentItem, nextAgentItemSeq, updateAgentItem } from '../stores/agent-items'
import { emitItem } from './transcript'

// Writes each item as it arrives and pushes it to the live chat.
export function transcriptSink(sessionId: number, followupId: number): TranscriptSink {
  const rows = new Map<string, number>()
  let seq = nextAgentItemSeq(followupId)
  return {
    item(item: TranscriptItem) {
      const { key, ...fields } = item
      const id = rows.get(key)
      const row = id !== undefined
        ? updateAgentItem(id, fields)
        : createAgentItem({ sessionId, followupId, seq: seq++, ...fields })
      if (!row) return
      rows.set(key, row.id)
      emitItem(row)
    },
    end() {},
  }
}
