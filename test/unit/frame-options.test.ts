import { createServer, request, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import * as h3 from 'h3'
import { isPreviewHost } from '../../shared/utils/preview-host'

Object.assign(globalThis, h3, { isPreviewHost })
const frameOptions = (await import('../../server/middleware/frame-options')).default

// node:http, not fetch: fetch drops a custom Host header.
async function headersFor(host: string): Promise<IncomingHttpHeaders> {
  const app = h3.createApp().use(frameOptions).use(h3.defineEventHandler(() => 'ok'))
  const server = createServer(h3.toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    return await new Promise((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: '/', headers: { host } }, (res) => {
        res.resume()
        resolve(res.headers)
      }).on('error', reject).end()
    })
  }
  finally {
    server.close()
  }
}

describe('frame options', () => {
  it('forbids framing the dashboard', async () => {
    const headers = await headersFor('knecht.example')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['content-security-policy']).toBe('frame-ancestors \'none\'')
  })

  it.each(['5.preview.knecht.example', 'ide--5.preview.knecht.example'])('leaves %s frameable for the preview browser', async (host) => {
    const headers = await headersFor(host)
    expect(headers['x-frame-options']).toBeUndefined()
    expect(headers['content-security-policy']).toBeUndefined()
  })
})
