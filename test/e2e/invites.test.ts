import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BASE_URL, expectJson, login, type E2eClient } from './client'

interface Invite { id: number, createdBy: string | null, expiresAt: string }
interface Member { id: number, login: string, invitedBy: string | null, isOwner: boolean }

const username = `e2e-${Date.now()}`
const password = 'correct horse battery'
let owner: E2eClient

async function createInvite(): Promise<{ invite: Invite, token: string }> {
  return expectJson(await owner.fetch('/api/invites', { method: 'POST' }))
}

function join(token: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE_URL}/auth/invite/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  owner = await login()
})

afterAll(async () => {
  await owner.fetch(`/api/members/${username}`, { method: 'DELETE' })
})

describe('invite links', () => {
  it('lets one person join with username and password, then stops working', async () => {
    const { invite, token } = await createInvite()
    expect((await expectJson<Invite[]>(await owner.fetch('/api/invites'))).map(i => i.id)).toContain(invite.id)

    const info = await expectJson<{ invitedBy: string }>(await fetch(`${BASE_URL}/auth/invite/${token}`))
    expect(info.invitedBy).toBe(owner.login.toLowerCase())

    expect((await join(token, { username, password: 'short' })).status).toBe(400)
    expect((await join(token, { username: owner.login, password })).status).toBe(409)

    const joined = await join(token, { username, password })
    expect(joined.status).toBe(200)
    const cookie = joined.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')

    const members = await expectJson<Member[]>(await fetch(`${BASE_URL}/api/members`, { headers: { cookie } }))
    expect(members.find(m => m.login === username)).toMatchObject({ invitedBy: owner.login.toLowerCase() })
    expect(JSON.stringify(members)).not.toContain('passwordHash')
    expect((await fetch(`${BASE_URL}/api/invites`, { method: 'POST', headers: { cookie } })).status).toBe(403)
    expect((await fetch(`${BASE_URL}/api/invites`, { headers: { cookie } })).status).toBe(403)
    expect((await fetch(`${BASE_URL}/api/members/${username}`, { method: 'DELETE', headers: { cookie } })).status).toBe(403)

    expect((await join(token, { username: `${username}-2`, password })).status).toBe(404)
    expect((await fetch(`${BASE_URL}/auth/invite/${token}`)).status).toBe(404)
    expect((await expectJson<Invite[]>(await owner.fetch('/api/invites'))).map(i => i.id)).not.toContain(invite.id)
  })

  it('refuses a revoked invite', async () => {
    const { invite, token } = await createInvite()
    await expectJson(await owner.fetch(`/api/invites/${invite.id}`, { method: 'DELETE' }))
    expect((await fetch(`${BASE_URL}/auth/invite/${token}`)).status).toBe(404)
  })

  it('refuses a join from a foreign origin', async () => {
    const { token } = await createInvite()
    expect((await join(token, { username, password }, { origin: 'https://evil.example' })).status).toBe(403)
  })

  it('logs out the removed member', async () => {
    const { token } = await createInvite()
    const name = `${username}-gone`
    const joined = await join(token, { username: name, password })
    const cookie = joined.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    await expectJson(await owner.fetch(`/api/members/${name}`, { method: 'DELETE' }))
    expect((await fetch(`${BASE_URL}/api/members`, { headers: { cookie } })).status).toBe(401)
  })
})

describe('password login', () => {
  it('signs a member in with username and password, and refuses a wrong one', async () => {
    const signIn = (body: unknown) => fetch(`${BASE_URL}/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect((await signIn({ username, password: 'wrong password!!' })).status).toBe(401)
    expect((await signIn({ username: `${username}-nobody`, password })).status).toBe(401)
    expect((await signIn({ username: owner.login, password })).status).toBe(401)

    const res = await signIn({ username: username.toUpperCase(), password })
    expect(res.status).toBe(200)
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    expect(cookie).toContain('knecht-last-login=password')
    expect((await fetch(`${BASE_URL}/api/members`, { headers: { cookie } })).status).toBe(200)

    const methods = await expectJson<{ password: boolean, github: { username: string | null } }>(await fetch(`${BASE_URL}/api/me/sign-in`, { headers: { cookie } }))
    expect(methods).toMatchObject({ password: true, github: { username: null } })
    expect((await fetch(`${BASE_URL}/api/me/identities/nope`, { method: 'DELETE', headers: { cookie } })).status).toBe(404)

    const link = await fetch(`${BASE_URL}/auth/github?link=1`, { headers: { cookie }, redirect: 'manual' })
    // CI's GitHub App comes from the dev env fallback, which has no OAuth client.
    if (link.headers.get('location') === '/setup') return
    expect(link.headers.get('location')).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize/)
    expect(link.headers.getSetCookie().join()).toContain('knecht-link=link')
  })
})

describe('password reset links', () => {
  it('lets an owner hand out a single-use link that sets a new password', async () => {
    const newPassword = 'a brand new password'
    const { token } = await expectJson<{ token: string }>(await owner.fetch(`/api/members/${username}/password-reset`, { method: 'POST' }))
    expect(await expectJson(await fetch(`${BASE_URL}/auth/reset/${token}`))).toEqual({ username })

    const reset = (body: unknown) => fetch(`${BASE_URL}/auth/reset/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect((await reset({ password: 'short' })).status).toBe(400)
    const done = await reset({ password: newPassword })
    expect(done.status).toBe(200)
    const cookie = done.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    expect((await fetch(`${BASE_URL}/api/members`, { headers: { cookie } })).status).toBe(200)
    expect((await reset({ password: newPassword })).status).toBe(404)

    const signIn = (pw: string) => fetch(`${BASE_URL}/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: pw }) })
    expect((await signIn(password)).status).toBe(401)
    expect((await signIn(newPassword)).status).toBe(200)
  })

  it('is only for owners', async () => {
    const res = await fetch(`${BASE_URL}/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'a brand new password' }) })
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    expect((await fetch(`${BASE_URL}/api/members/${username}/password-reset`, { method: 'POST', headers: { cookie } })).status).toBe(403)
  })
})

describe('owner role', () => {
  it('lets an owner promote a member, who can then manage invites, and demote them again', async () => {
    const promoted = await expectJson<Member[]>(await owner.fetch(`/api/members/${username}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOwner: true }) }))
    expect(promoted.find(m => m.login === username)).toMatchObject({ isOwner: true })

    const res = await fetch(`${BASE_URL}/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'a brand new password' }) })
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    expect((await fetch(`${BASE_URL}/api/invites`, { headers: { cookie } })).status).toBe(200)

    expect((await owner.fetch(`/api/members/${username}`, { method: 'DELETE' })).status).toBe(403)
    await expectJson(await owner.fetch(`/api/members/${username}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOwner: false }) }))
    expect((await fetch(`${BASE_URL}/api/invites`, { headers: { cookie } })).status).toBe(403)
  })
})

describe('own password', () => {
  it('changes without the current one while the session is fresh', async () => {
    const signIn = (pw: string) => fetch(`${BASE_URL}/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: pw }) })
    const sessionCookie = (res: Response) => res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    const cookie = sessionCookie(await signIn('a brand new password'))
    const change = (cookie: string, body: unknown) => fetch(`${BASE_URL}/api/me/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) })

    expect((await change(cookie, { password: 'short' })).status).toBe(400)
    const changed = await change(cookie, { password: 'the third password' })
    expect(changed.status).toBe(200)
    expect((await change(cookie, { password: 'the third password' })).status).toBe(401)
    expect((await change(sessionCookie(changed), { password: 'the third password' })).status).toBe(200)

    expect((await signIn('a brand new password')).status).toBe(401)
    expect((await signIn('the third password')).status).toBe(200)
  })
})

describe('confirm it is you', () => {
  it('asks a session past its hour to confirm before sensitive actions', async () => {
    const secret = process.env.KNECHT_TEST_AUTH!
    const stale = await fetch(`${BASE_URL}/_test/login?secret=${encodeURIComponent(secret)}&stale=1`)
    const cookie = stale.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')

    expect((await fetch(`${BASE_URL}/api/members`, { headers: { cookie } })).status).toBe(200)
    for (const [path, method] of [['/api/invites', 'POST'], [`/api/members/${username}/password-reset`, 'POST'], ['/api/me/elevated', 'GET'], ['/api/projects/999999', 'DELETE']]) {
      const res = await fetch(`${BASE_URL}${path}`, { method, headers: { cookie } })
      expect(res.status).toBe(403)
      expect(((await res.json()) as { data: { reauth: boolean } }).data.reauth).toBe(true)
    }
  })

  it('lets a member confirm with their password', async () => {
    const res = await fetch(`${BASE_URL}/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'the third password' }) })
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    const elevate = (password: string) => fetch(`${BASE_URL}/auth/elevate`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ password }) })
    expect((await elevate('not my password')).status).toBe(400)
    expect((await elevate('the third password')).status).toBe(200)
  })
})

describe('profile', () => {
  // A 1x1 PNG.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('sets a picture and a display name of their own', async () => {
    const res = await fetch(`${BASE_URL}/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'the third password' }) })
    let cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    const send = async (path: string, method: string, body?: unknown) => {
      const r = await fetch(`${BASE_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
      const fresh = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
      if (fresh) cookie = fresh
      return r
    }

    expect((await send('/api/me/avatar', 'PUT', { image: 'data:text/html;base64,PGgxPg==' })).status).toBe(400)
    expect((await send('/api/me/avatar', 'PUT', { image: PNG })).status).toBe(200)
    expect((await send('/api/me', 'PATCH', { name: 'E2E Person' })).status).toBe(200)

    const me = (await expectJson<{ login: string, name: string, avatarUrl: string }[]>(await send('/api/members', 'GET'))).find(m => m.login === username)!
    expect(me.name).toBe('E2E Person')
    const picture = await send(me.avatarUrl, 'GET')
    expect(picture.headers.get('content-type')).toBe('image/png')
    expect((await picture.arrayBuffer()).byteLength).toBeGreaterThan(50)
    expect(JSON.stringify(await (await send('/api/members', 'GET')).json())).not.toContain('base64')

    expect((await send('/api/me/avatar', 'DELETE')).status).toBe(200)
    expect((await send(me.avatarUrl, 'GET')).status).toBe(404)
  })
})
