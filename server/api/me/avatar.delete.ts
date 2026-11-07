import { setAvatarImage } from '../../stores/members'
import { setMemberSession } from '../../utils/member-session'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  await setMemberSession(event, setAvatarImage(user.id, null))
  return { ok: true }
})
