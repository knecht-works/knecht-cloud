import { request, createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener } from 'h3'
import '../helpers/routes'
import { isPreviewHost } from '../../shared/utils/preview-host'
import { isForeignOrigin } from '../../server/utils/origin'

Object.assign(globalThis, {
  isPreviewHost,
  isForeignOrigin,
  requireUserSession: async () => {
    throw createError({ statusCode: 401, statusMessage: 'No session' })
  },
  clearUserSession: async () => {},
})

const authMiddleware = (await import('../../server/middleware/auth')).default

let server: Server
let port: number

beforeAll(async () => {
  const router = createRouter()
    .get('/api/members', defineEventHandler(() => 'HANDLER-REACHED'))
    .patch('/api/settings', defineEventHandler(() => 'HANDLER-REACHED'))
  const app = createApp().use(authMiddleware).use(router)
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(() => {
  server.close()
})

// node:http sends the path verbatim; fetch could normalize it before it reaches the server.
function send(method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: 'knecht.example', ...headers } }, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

const prefixes = ['/api/', '/%61pi/', '/a%70i/', '/ap%69/', '/%61%70%69/']

describe('dashboard /api gate', () => {
  it.each(prefixes)('requires a session for GET %smembers', async (prefix) => {
    const res = await send('GET', `${prefix}members`)
    expect(res.status).toBe(401)
    expect(res.body).not.toContain('HANDLER-REACHED')
  })

  it.each(prefixes)('refuses a foreign Origin for PATCH %ssettings', async (prefix) => {
    const res = await send('PATCH', `${prefix}settings`, { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(res.body).not.toContain('HANDLER-REACHED')
  })

  it('still gates a request that carries a query string', async () => {
    const res = await send('GET', '/%61pi/members?x=1')
    expect(res.status).toBe(401)
  })
})
