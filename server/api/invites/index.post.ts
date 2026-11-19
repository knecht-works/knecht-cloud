import { createInvite } from '#server/stores/invites'
import { requireOwner } from '#server/utils/owner'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  return createInvite(owner.login)
})
