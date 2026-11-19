import { setAvatarImage } from '../../stores/members'
import { updateMemberSession } from '../../utils/member-session'
import { defineEventHandler } from 'h3'
import { requireUserSession } from '#imports'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  await updateMemberSession(event, setAvatarImage(user.id, null))
  return { ok: true }
})
