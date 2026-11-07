import { z } from 'zod'
import { getMember } from '../../stores/members'
import { rememberLoginMethod } from '../../utils/last-login'
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from '../../utils/login-attempts'
import { isForeignOrigin } from '../../utils/origin'
import { startMemberSession } from '../../utils/member-session'

const bodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(1024),
})

// Hashing for unknown usernames too keeps the response time from telling which ones exist.
let dummyHash: Promise<string> | undefined

export default defineEventHandler(async (event) => {
  if (isForeignOrigin(getRequestHeader(event, 'origin'), event.node.req.headers.host ?? '')) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request refused' })
  }
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Enter username and password.' })
  }
  const { username, password } = result.data
  const userKey = `user:${username.toLowerCase()}`
  const keys = [userKey, `ip:${getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'}`]
  if (isLoginBlocked(keys)) {
    throw createError({ statusCode: 429, statusMessage: 'Too many failed attempts. Try again in 15 minutes.' })
  }

  const member = getMember(username)
  dummyHash ??= hashPassword('knecht-dummy-password')
  const valid = await verifyPassword(member?.passwordHash ?? await dummyHash, password)
  if (!member?.passwordHash || !valid) {
    recordLoginFailure(keys)
    throw createError({ statusCode: 401, statusMessage: 'Wrong username or password.' })
  }

  // The client's count stays: one valid account must not reset the tries on others.
  clearLoginFailures([userKey])
  await startMemberSession(event, member)
  rememberLoginMethod(event, 'password')
  return { ok: true }
})
