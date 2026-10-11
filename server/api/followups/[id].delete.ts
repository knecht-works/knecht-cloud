import { deleteQueuedFollowup, getFollowup } from '../../stores/followups'
import { removeAttachments } from '../../utils/attachments'
import { emitLive } from '../../utils/live'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const row = getFollowup(id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Follow-up not found' })
  if (row.status !== 'queued') throw createError({ statusCode: 409, statusMessage: 'Only a queued message can be removed' })

  deleteQueuedFollowup(id)
  removeAttachments([id])
  emitLive({ type: 'followup-removed', sessionId: row.sessionId, id })
  return { removed: true }
})
