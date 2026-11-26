import { createServer, request, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import { makeProject, makeSession } from '../helpers/db'

const upstream = vi.hoisted(() => ({ port: 0 }))
vi.mock('#server/daemon/envs', () => ({ envTransition: () => null, reviveEnv: async () => {} }))
vi.mock('#server/daemon/sandbox', () => ({ resolvePreview: async () => '127.0.0.1', forgetPreview: () => {} }))
vi.mock('#server/daemon/ddev', async importOriginal => ({
  ...await importOriginal<typeof import('#server/daemon/ddev')>(),
  previewTargetPort: () => upstream.port,
  readDdevHosts: () => ({ primary: 'rotax.ddev.site', all: ['rotax.ddev.site'] }),
}))
vi.mock('#imports', () => ({ getUserSession: async () => ({}), clearUserSession: async () => {} }))

const { proxyRunPreview } = await import('#server/utils/preview-proxy')

// Drops every request that arrives on a kept-alive socket, as a dev server does
// when its keep-alive timeout fires while its event loop was blocked.
const served = new WeakSet<Socket>()
let site: Server
beforeAll(async () => {
  site = createServer((req, res) => {
    if (served.has(req.socket)) {
      req.socket.destroy()
      return
    }
    served.add(req.socket)
    res.setHeader('content-type', 'text/javascript')
    res.end(`export const path = '${req.url}'`)
  })
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve))
  upstream.port = (site.address() as AddressInfo).port
})
afterAll(() => site.close())

function get(port: number, sessionId: number, path: string, method = 'GET'): Promise<{ status: number, body: string }> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, method, headers: { host: `${sessionId}.preview.knecht.test` } }, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => resolve({ status: res.statusCode!, body }))
    }).on('error', reject).end()
  })
}

describe('preview proxy on a dropped kept-alive connection', () => {
  it('retries a GET on a fresh connection', async () => {
    const session = makeSession(makeProject({ previewAccess: 'public' }), { envState: 'up', tier: 'preview', previewHosts: ['rotax.ddev.site'] })
    const app = createApp().use(event => proxyRunPreview(event, session.id, undefined, false))
    const server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const { port } = server.address() as AddressInfo
      expect(await get(port, session.id, '/a.ts')).toEqual({ status: 200, body: `export const path = '/a.ts'` })
      expect(await get(port, session.id, '/b.ts')).toEqual({ status: 200, body: `export const path = '/b.ts'` })
    }
    finally {
      server.close()
    }
  })
})
