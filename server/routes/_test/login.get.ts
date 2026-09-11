// The secret is the primary gate: the app runs in Docker, so a loopback check
// can't tell host-local from LAN. import.meta.dev drops the body from prod builds.
import { timingSafeEqual } from 'node:crypto'

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404 })
  }

  const expected = process.env.KNECHT_TEST_AUTH
  if (!expected) {
    throw createError({ statusCode: 404, statusMessage: 'Dev login disabled (set KNECHT_TEST_AUTH)' })
  }
  const provided = getQuery(event).secret
  if (typeof provided !== 'string' || !timingSafeMatch(provided, expected)) {
    throw createError({ statusCode: 401, statusMessage: 'Bad or missing secret' })
  }

  const token = process.env.KNECHT_TEST_GITHUB_TOKEN
  if (!token) {
    throw createError({ statusCode: 500, statusMessage: 'Set KNECHT_TEST_GITHUB_TOKEN to seed a session' })
  }

  const ghUser = await $fetch<{ login: string, name: string | null, avatar_url: string }>(
    'https://api.github.com/user',
    { headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'knecht-dev-login' } },
  ).catch(() => {
    throw createError({ statusCode: 502, statusMessage: 'GitHub rejected KNECHT_TEST_GITHUB_TOKEN' })
  })

  await setUserSession(event, {
    user: {
      login: ghUser.login,
      name: ghUser.name,
      avatarUrl: ghUser.avatar_url,
    },
  })

  return { ok: true, login: ghUser.login }
})

function timingSafeMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
