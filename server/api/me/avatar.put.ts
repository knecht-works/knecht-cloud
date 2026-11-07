import { z } from 'zod'
import { setAvatarImage } from '../../stores/members'
import { updateMemberSession } from '../../utils/member-session'

// The dashboard scales pictures to 256 px before uploading, which stays far below this.
const MAX_LENGTH = 300_000

const bodySchema = z.object({
  image: z.string().max(MAX_LENGTH).regex(/^data:image\/(?:png|jpeg|webp);base64,[\w+/]+=*$/),
})

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Upload a PNG, JPEG or WebP picture.' })
  }
  await updateMemberSession(event, setAvatarImage(user.id, result.data.image))
  return { ok: true }
})
