// Dev-only session seeder. Lets an automated agent (or a manual curl) obtain a
// real logged-in session WITHOUT the interactive GitHub OAuth dance, so the
// running app can be driven end-to-end for verification. It uses the SAME
// `setUserSession` machinery as the real OAuth callback (server/routes/auth/
// github.get.ts), so every downstream route runs its real code path; no auth is
// reimplemented or duplicated here.
//
// It is fenced off three ways, all of which must pass:
//   1. `import.meta.dev`: the handler body is dead-code-eliminated from a
//      production build, so this endpoint does not exist in production at all.
//   2. `KNECHT_TEST_AUTH` must be set AND matched by the request's `secret`
//      (constant-time), so it is inert even in dev unless the operator opts in.
//      This is the primary gate: the app runs inside a Docker container, so a
//      network/loopback check can't work (requests arrive via the docker
//      gateway and a published port can't distinguish host-local from LAN).
//   3. `KNECHT_TEST_GITHUB_TOKEN` must be a REAL GitHub token: it resolves the
//      session's identity from the GitHub API, mirroring the OAuth callback.
//      (Repo access itself comes from the GitHub App, not the session.)
//
// Usage (cookie must round-trip to the app's cookie domain; use the same host
// the app runs on; with KNECHT_BASE_DOMAIN=lvh.me that is lvh.me:3000):
//   curl -c jar.txt 'http://lvh.me:3000/_test/login?secret=<KNECHT_TEST_AUTH>'
//   curl -b jar.txt  'http://lvh.me:3000/api/projects'
import { timingSafeEqual } from 'node:crypto'

export default defineEventHandler(async (event) => {
  // (1) Absent from production builds; a defensive 404 if the guard is ever
  // reached at runtime in a non-dev context.
  if (!import.meta.dev) {
    throw createError({ statusCode: 404 })
  }

  // (2) Off unless the operator opts in with a secret, and the caller presents it.
  const expected = process.env.KNECHT_TEST_AUTH
  if (!expected) {
    throw createError({ statusCode: 404, statusMessage: 'Dev login disabled (set KNECHT_TEST_AUTH)' })
  }
  const provided = getQuery(event).secret
  if (typeof provided !== 'string' || !timingSafeMatch(provided, expected)) {
    throw createError({ statusCode: 401, statusMessage: 'Bad or missing secret' })
  }

  // (3) A real GitHub token is required to resolve a real identity, not a
  // token-less stub.
  const token = process.env.KNECHT_TEST_GITHUB_TOKEN
  if (!token) {
    throw createError({ statusCode: 500, statusMessage: 'Set KNECHT_TEST_GITHUB_TOKEN to seed a session' })
  }

  // Resolve the real GitHub identity from the token so the session's `user`
  // matches what the OAuth callback would set (login is used by runs/triggers).
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

// Constant-time compare so the secret (the primary gate) can't be probed
// byte-by-byte via response timing.
function timingSafeMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
