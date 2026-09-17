import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { removeAttachments } from '../../utils/attachments'
import { emitLive } from '../../utils/live'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const row = db.select({ sessionId: schema.followups.sessionId, status: schema.followups.status })
    .from(schema.followups).where(eq(schema.followups.id, id)).get()
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Follow-up not found' })
  if (row.status !== 'queued') throw createError({ statusCode: 409, statusMessage: 'Only a queued message can be removed' })

  db.delete(schema.followups).where(and(eq(schema.followups.id, id), eq(schema.followups.status, 'queued'))).run()
  removeAttachments([id])
  emitLive({ type: 'followup-removed', sessionId: row.sessionId, id })
  return { removed: true }
})
