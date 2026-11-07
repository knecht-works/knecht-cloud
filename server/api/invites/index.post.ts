import { createInvite } from '../../stores/invites'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  return createInvite(user.login)
})
