import { listOpenInvites, revokeInvite } from '../../stores/invites'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Missing invite id.' })
  }
  revokeInvite(id)
  return listOpenInvites()
})
