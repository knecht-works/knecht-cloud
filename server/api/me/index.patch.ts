import { z } from 'zod'
import { setName } from '../../stores/members'
import { updateMemberSession } from '../../utils/member-session'

const bodySchema = z.object({ name: z.string().trim().max(80) })

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Use at most 80 characters.', data: { field: 'name' } })
  }
  await updateMemberSession(event, setName(user.id, result.data.name || null))
  return { ok: true }
})
