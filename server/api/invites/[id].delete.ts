import { listOpenInvites, revokeInvite } from '../../stores/invites'
import { requireOwner } from '../../utils/owner'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Missing invite id.' })
  }
  revokeInvite(id)
  return listOpenInvites()
})
