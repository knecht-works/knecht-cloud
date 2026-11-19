import { listOpenInvites } from '../../stores/invites'
import { requireOwner } from '../../utils/owner'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return listOpenInvites()
})
