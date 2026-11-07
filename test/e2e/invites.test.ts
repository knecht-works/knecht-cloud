import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BASE_URL, expectJson, login, type E2eClient } from './client'

interface Invite { id: number, createdBy: string | null, expiresAt: string }
interface Member { id: number, login: string, invitedBy: string | null }

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
    expect(link.headers.get('location')).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize/)
    expect(link.headers.getSetCookie().join()).toContain('knecht-link=1')
  })
})
