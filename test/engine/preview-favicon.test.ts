import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeProject, makeSession } from '../helpers/db'

const ports = vi.hoisted(() => ({ preview: 0, extra: [] as number[] }))
vi.mock('#server/daemon/sandbox', () => ({ resolvePreview: async () => '127.0.0.1' }))
vi.mock('#server/utils/preview-target', () => ({ sessionPreviewUrl: () => 'http://1.preview.knecht.test/' }))
vi.mock('#server/daemon/ddev', () => ({
  previewTargetPort: () => ports.preview,
  readDdevHosts: () => ({ primary: 'site.ddev.site', all: ['site.ddev.site'] }),
  readDdevConfig: () => ({ extraPorts: ports.extra.map(port => ({ name: 'nuxt', port })) }),
}))

const { detectPreviewFavicon } = await import('#server/utils/favicon')
const { requireProject } = await import('#server/stores/projects')

const servers: Server[] = []
afterEach(() => {
  servers.splice(0).forEach(s => s.close())
  ports.extra = []
})

async function serve(handler: RequestListener): Promise<number> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

const backend: RequestListener = (req, res) => {
  if (req.url === '/') return res.end('<html><head><title>CMS</title></head></html>')
  res.statusCode = 404
  res.end()
}

const frontend: RequestListener = (req, res) => {
  if (req.url === '/') return res.end('<html><head><link rel="icon" href="/favicon/favicon-32x32.png"></head></html>')
  if (req.url === '/favicon/favicon-32x32.png') {
    res.setHeader('content-type', 'image/png')
    return res.end('PNGDATA')
  }
  res.statusCode = 404
  res.end()
}

describe('detectPreviewFavicon', () => {
  it('falls back to an extra exposed port when the preview port has no favicon', async () => {
    ports.preview = await serve(backend)
    ports.extra = [await serve(frontend)]
    const project = makeProject({ favicon: '' })
    const session = makeSession(project, { tier: 'preview' })

    await detectPreviewFavicon(session.id, project)

    expect(requireProject(project.id).favicon).toBe(`data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}`)
  })

  it('prefers the preview port when it serves a favicon', async () => {
    ports.preview = await serve(frontend)
    ports.extra = [await serve((_req, res) => {
      res.setHeader('content-type', 'image/x-icon')
      res.end('OTHER')
    })]
    const project = makeProject({ favicon: '' })
    const session = makeSession(project, { tier: 'preview' })

    await detectPreviewFavicon(session.id, project)

    expect(requireProject(project.id).favicon).toBe(`data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}`)
  })

  it('stores nothing when no port serves a favicon', async () => {
    ports.preview = await serve(backend)
    const project = makeProject({ favicon: '' })
    const session = makeSession(project, { tier: 'preview' })

    await detectPreviewFavicon(session.id, project)

    expect(requireProject(project.id).favicon).toBe('')
  })
})
