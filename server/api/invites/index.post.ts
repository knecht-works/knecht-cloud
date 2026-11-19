import { createInvite } from '../../stores/invites'
import { requireOwner } from '../../utils/owner'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  return createInvite(owner.login)
})
