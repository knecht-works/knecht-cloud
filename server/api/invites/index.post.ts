import { createInvite } from '../../stores/invites'
import { requireOwner } from '../../utils/owner'

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  return createInvite(owner.login)
})
