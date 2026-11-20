import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import { makeProject, makeSession } from '../helpers/db'

const upstream = vi.hoisted(() => ({ port: 0, html: '' }))
vi.mock('#server/daemon/envs', () => ({ envTransition: () => null, reviveEnv: async () => {} }))
vi.mock('#server/daemon/sandbox', () => ({ resolvePreview: async () => '127.0.0.1', forgetPreview: () => {} }))
vi.mock('#server/daemon/ddev', async importOriginal => ({
  ...await importOriginal<typeof import('#server/daemon/ddev')>(),
  previewTargetPort: () => upstream.port,
  readDdevHosts: () => ({ primary: 'rotax.ddev.site', all: ['rotax.ddev.site'] }),
}))
vi.mock('#imports', () => ({ getUserSession: async () => ({}), clearUserSession: async () => {} }))

const { proxyRunPreview } = await import('#server/utils/preview-proxy')
const { devServerLabel } = await import('#server/utils/dev-origin')
const { noteDevServerUse } = await import('#server/daemon/dev-server')

let site: Server
beforeAll(async () => {
  site = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(upstream.html)
  })
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve))
  upstream.port = (site.address() as AddressInfo).port
})
afterAll(() => site.close())

async function page(sessionId: number, html: string): Promise<string> {
  upstream.html = html
  const app = createApp().use(event => proxyRunPreview(event, sessionId, undefined, false))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    return await new Promise<string>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: '/', headers: { host: `${sessionId}.preview.knecht.test`, accept: 'text/html' } }, (res) => {
        let body = ''
        res.on('data', c => body += c)
        res.on('end', () => resolve(body))
      }).on('error', reject).end()
    })
  }
  finally {
    server.close()
  }
}

function devSession(urlMode: 'env' | 'rewrite', previewPort: number | null = 3000) {
  const project = makeProject({ previewAccess: 'public' })
  return makeSession(project, { envState: 'up', tier: 'preview', previewHosts: ['rotax.ddev.site'], previewPort, urlMode })
}

describe('preview proxy and the local dev server URL', () => {
  for (const urlMode of ['env', 'rewrite'] as const) {
    it(`points a local dev server script at the dev origin in ${urlMode} mode`, async () => {
      const session = devSession(urlMode)
      const dev = `${devServerLabel(session.id)}--${session.id}.preview.knecht.test`
      const body = await page(session.id, [
        '<html><head>',
        '<script type="module" src="https://localhost:3000/assets/js/app.ts"></script>',
        '<script type="module" src="https://rotax.ddev.site:3000/@vite/client"></script>',
        '</head></html>',
      ].join(''))
      expect(body).toContain(`<script crossorigin="use-credentials" type="module" src="http://${dev}/assets/js/app.ts"></script>`)
      expect(body).toContain(`<script crossorigin="use-credentials" type="module" src="http://${dev}/@vite/client"></script>`)
    })
  }

  it('leaves the page alone when the session has no dev server', async () => {
    const session = devSession('env', null)
    const tag = '<script type="module" src="https://localhost:3000/assets/js/app.ts"></script>'
    expect(await page(session.id, `<html><head>${tag}</head></html>`)).toContain(tag)
  })
})

describe('noteDevServerUse', () => {
  async function bootLog(html: string, previewHosts = ['rotax.ddev.site']): Promise<string> {
    upstream.html = html
    const session = makeSession(makeProject(), { envState: 'up', tier: 'preview', previewHosts, previewPort: 3000 })
    const lines: string[] = []
    await noteDevServerUse(session.id, text => lines.push(text))
    return lines.join('')
  }

  it('logs the local dev server URL the start page loads', async () => {
    expect(await bootLog('<script type="module" src="https://localhost:3000/assets/js/app.ts"></script>'))
      .toContain('https://localhost:3000/assets/js/app.ts')
  })

  it('logs that the start page loads nothing from the dev server', async () => {
    expect(await bootLog('<script type="module" src="/dist/app-abc.js"></script>')).toContain('loads nothing from it')
  })

  it('stays quiet in a generated environment, where the dev server serves the page', async () => {
    expect(await bootLog('<script type="module" src="/dist/app-abc.js"></script>', [])).toBe('')
  })
})
