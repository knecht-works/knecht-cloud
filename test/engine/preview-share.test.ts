import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import { callRoute } from '../helpers/routes'
import { getSessionRow, makeProject, makeSession } from '../helpers/db'
import type { Project } from '../../server/db/schema'
import { previewHostname, previewLabel, stripPreviewPrefix } from '../../shared/utils/preview-host'

const reviveEnv = vi.fn(async (_sessionId: number) => {})
vi.mock('../../server/daemon/envs', () => ({
  envTransition: () => null,
  reviveEnv: (sessionId: number) => reviveEnv(sessionId),
}))
vi.mock('../../server/daemon/sandbox', () => ({
  resolvePreview: async () => null,
  forgetPreview: () => {},
}))

Object.assign(globalThis, {
  stripPreviewPrefix,
  previewHostname,
  previewLabel,
  getUserSession: async () => ({}),
  clearUserSession: async () => {},
})

const { proxyRunPreview } = await import('../../server/utils/preview-proxy')
const { cookieValue, shareSession, shareToken } = await import('../../server/utils/preview-share')
const { updateSettings } = await import('../../server/utils/settings')
const share = (await import('../../server/api/sessions/[id]/share.post')).default

afterEach(() => {
  updateSettings({ previewAccess: 'login', shareLinkHours: 24, idleStopMinutes: 1440, previewRetentionDays: 7 })
  reviveEnv.mockClear()
})

function previewSession(project: Project = makeProject(), envState: 'up' | 'stopped' = 'up') {
  return makeSession(project, { envState, tier: 'preview', previewHosts: ['site.ddev.site'] })
}

async function visit(sessionId: number, opts: { path?: string, shareCookie?: string } = {}) {
  const app = createApp().use(event => proxyRunPreview(event, sessionId, undefined, false, opts.shareCookie))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    return await new Promise<{ status: number, location?: string, setCookie: string[], body: string }>((resolve, reject) => {
      request({
        host: '127.0.0.1',
        port,
        path: opts.path ?? '/',
        headers: { host: `${sessionId}.preview.knecht.test`, accept: 'text/html' },
      }, (res) => {
        let body = ''
        res.on('data', c => body += c)
        res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, setCookie: res.headers['set-cookie'] ?? [], body }))
      }).on('error', reject).end()
    })
  }
  finally {
    server.close()
  }
}

// resolvePreview is stubbed to nothing, so a visitor who got past the gate sees the 503.
const PASSED = 503

describe('preview access', () => {
  it('sends a visitor without a login to the login page by default', async () => {
    const res = await visit(previewSession().id)
    expect(res.status).toBe(302)
    expect(res.location).toBe('http://knecht.test/login')
  })

  it('lets anyone in when the project or the instance is public, and a project can opt back into the login', async () => {
    expect((await visit(previewSession(makeProject({ previewAccess: 'public' })).id)).status).toBe(PASSED)

    updateSettings({ previewAccess: 'public' })
    expect((await visit(previewSession().id)).status).toBe(PASSED)
    expect((await visit(previewSession(makeProject({ previewAccess: 'login' })).id)).status).toBe(302)
  })

  it('lets a guest in with an unexpired share cookie of this session only', async () => {
    const session = previewSession()
    const other = previewSession()
    const { token } = shareSession(session.id, { shareLinkHours: null })
    shareSession(other.id, { shareLinkHours: null })

    expect((await visit(session.id, { shareCookie: token })).status).toBe(PASSED)
    expect((await visit(other.id, { shareCookie: token })).status).toBe(302)
  })

  it('turns the share link into a cookie and drops it from the URL', async () => {
    const session = previewSession()
    const { token } = shareSession(session.id, { shareLinkHours: null })

    const res = await visit(session.id, { path: `/blog?page=2&knecht-share=${token}` })

    expect(res.status).toBe(302)
    expect(res.location).toBe(`http://${session.id}.preview.knecht.test/blog?page=2`)
    expect(res.setCookie.join()).toContain(`knecht-share-${session.id}=${token}`)
    expect(res.setCookie.join()).toMatch(/HttpOnly/i)
  })

  it('refuses an expired share link, even with the right token', async () => {
    const session = previewSession()
    shareSession(session.id, { shareLinkHours: null })
    const { db, schema } = await import('../../server/db')
    const { eq } = await import('drizzle-orm')
    db.update(schema.sessions).set({ shareExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.sessions.id, session.id)).run()

    expect((await visit(session.id, { path: `/?knecht-share=${shareToken(session.id)}` })).status).toBe(410)
    expect((await visit(session.id, { shareCookie: shareToken(session.id) })).status).toBe(302)
  })

  it('wakes a stopped preview for an allowed visitor and shows a waiting page', async () => {
    const session = previewSession(makeProject({ previewAccess: 'public' }), 'stopped')

    const res = await visit(session.id)

    expect(res.status).toBe(503)
    expect(res.body).toContain('starting now')
    expect(reviveEnv).toHaveBeenCalledWith(session.id)
  })

  it('never wakes a stopped preview for a visitor who is not let in', async () => {
    await visit(previewSession(makeProject(), 'stopped').id)
    expect(reviveEnv).not.toHaveBeenCalled()
  })
})

describe('POST /api/sessions/:id/share', () => {
  async function shareFor(settings: Parameters<typeof updateSettings>[0]) {
    updateSettings(settings)
    const session = previewSession()
    const before = Date.now()
    const res = await callRoute(share, { route: '/:id', path: `/${session.id}` })
    expect(res.status).toBe(200)
    const minutes = (new Date((res.json as { expiresAt: string }).expiresAt).getTime() - before) / 60_000
    return { session, before, minutes: Math.round(minutes) }
  }

  it('starts the link from now and keeps the env live', async () => {
    const { session, before, minutes } = await shareFor({ shareLinkHours: 10 })
    expect(minutes).toBe(600)
    expect(getSessionRow(session.id).previewLastSeen!.getTime()).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000)
  })

  it('uses the project\'s duration over the global one', async () => {
    updateSettings({ shareLinkHours: 10 })
    const session = previewSession(makeProject({ shareLinkHours: 2 }))
    const before = Date.now()
    const res = await callRoute(share, { route: '/:id', path: `/${session.id}` })
    const minutes = (new Date((res.json as { expiresAt: string }).expiresAt).getTime() - before) / 60_000
    expect(Math.round(minutes)).toBe(120)
  })

  it('lasts as long as possible without a duration', async () => {
    expect((await shareFor({ shareLinkHours: null, idleStopMinutes: 60, previewRetentionDays: 1 })).minutes).toBe(60 + 1440)
    expect((await shareFor({ shareLinkHours: null, idleStopMinutes: 60, previewRetentionDays: 0 })).minutes).toBe(8760 * 60)
  })

  it('caps the link at the live and stopped time, so it never has to restore an archive', async () => {
    expect((await shareFor({ shareLinkHours: 100, idleStopMinutes: 60, previewRetentionDays: 1 })).minutes).toBe(60 + 1440)
    expect((await shareFor({ shareLinkHours: 100, idleStopMinutes: 60, previewRetentionDays: 0 })).minutes).toBe(6000)
  })

  it('refuses a session without an environment', async () => {
    const session = makeSession(makeProject())
    const res = await callRoute(share, { route: '/:id', path: `/${session.id}` })
    expect(res.status).toBe(409)
  })
})

describe('cookieValue', () => {
  it('reads one cookie from a raw header, keeping = inside the value', () => {
    expect(cookieValue('theme=dark; knecht-share-7=a=b', 'knecht-share-7')).toBe('a=b')
    expect(cookieValue('knecht-share-70=x', 'knecht-share-7')).toBeUndefined()
    expect(cookieValue('', 'nuxt-session')).toBeUndefined()
  })
})
