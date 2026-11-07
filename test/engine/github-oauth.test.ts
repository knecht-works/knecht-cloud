import { afterAll, describe, expect, it, vi } from 'vitest'
import { createApp, toWebHandler } from 'h3'
import '../helpers/routes'

vi.mock('../../server/utils/github-credentials', () => ({
  githubAppCredentials: () => ({ clientId: 'client', clientSecret: 'secret' }),
}))
vi.stubEnv('NODE_ENV', 'production')
const exchangeCode = vi.fn(async () => ({}))
Object.assign(globalThis, { $fetch: exchangeCode })
const handler = (await import('../../server/routes/auth/github.get')).default
const send = toWebHandler(createApp().use('/auth/github', handler))
const get = (path: string, cookie?: string) => send(new Request(`https://knecht.example${path}`, { headers: cookie ? { cookie } : {} }))

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('GitHub OAuth flow cookies', () => {
  it('are __Host- cookies, which a preview subdomain cannot set', async () => {
    const res = await get('/auth/github?link=1&return=/profile')
    const cookies = res.headers.getSetCookie()
    expect(cookies.map(c => c.split('=')[0])).toEqual(['__Host-knecht-oauth-state', '__Host-knecht-link', '__Host-knecht-return'])
    for (const cookie of cookies) {
      expect(cookie).toMatch(/; Secure/)
      expect(cookie).toMatch(/; Path=\//)
      expect(cookie).not.toMatch(/Domain=/i)
    }
  })

  it('ignore a state planted under the plain names', async () => {
    const res = await get('/auth/github?code=attacker&state=planted', 'knecht-oauth-state=planted; knecht-link=link')
    expect(res.headers.get('location')).toBe('/login?error=oauth')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('keep a return path only when it stays on the dashboard', async () => {
    const res = await get('/auth/github?elevate=1&return=/%5Cevil.example')
    expect(res.headers.getSetCookie().join()).not.toContain('knecht-return')
  })
})
