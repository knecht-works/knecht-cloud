import { listOpenInvites } from '#server/stores/invites'
import { requireOwner } from '#server/utils/owner'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return listOpenInvites()
})
