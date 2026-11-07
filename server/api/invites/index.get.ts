import { listOpenInvites } from '../../stores/invites'
import { requireOwner } from '../../utils/owner'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return listOpenInvites()
})
