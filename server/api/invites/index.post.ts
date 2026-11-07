import { createInvite } from '../../stores/invites'
import { requireOwner } from '../../utils/owner'
import { requireElevated } from '../../utils/member-session'

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  await requireElevated(event)
  return createInvite(owner.login)
})
