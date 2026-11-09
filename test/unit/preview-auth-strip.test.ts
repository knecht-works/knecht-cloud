import { createServer, request, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as h3 from 'h3'
import { parsePreviewHost } from '../../shared/utils/preview-host'
import { isPreviewAuthToken, PREVIEW_AUTH_HEADER, previewAwareFetch } from '../../server/utils/preview-fetch'
import { withoutKnechtCookies } from '../../server/utils/preview-proxy'

const seen: { proxy: string, headers: IncomingHttpHeaders, internal?: boolean }[] = []
function recorder(proxy: string) {
  return async (event: h3.H3Event, _sessionId: number, ...rest: unknown[]) => {
    seen.push({ proxy, headers: { ...event.node.req.headers }, internal: rest[1] as boolean | undefined })
    event.node.res.end('ok')
  }
}

Object.assign(globalThis, h3, {
  parsePreviewHost,
  isPreviewAuthToken,
  PREVIEW_AUTH_HEADER,
  withoutKnechtCookies,
  shareCookieName: (id: number) => `knecht-share-${id}`,
  getUserSession: async () => ({}),
  isIdeLabel: (label?: string) => label === 'ide',
  findSessionService: async (_id: number, label: string) => label === 'mailpit' ? { label } : undefined,
  proxyRunIde: recorder('ide'),
  proxyRunService: recorder('service'),
  proxyRunPreview: recorder('preview'),
})
const middleware = (await import('../../server/middleware/preview')).default

async function liveToken(sessionId = 5): Promise<string> {
  let token = ''
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    token = new Headers(init.headers).get(PREVIEW_AUTH_HEADER) ?? ''
    return new Response('')
  })
  await previewAwareFetch(`http://${sessionId}.preview.knecht.test/`, sessionId)
  vi.unstubAllGlobals()
  return token
}

async function send(host: string, headers: Record<string, string>) {
  const server = createServer(h3.toNodeListener(h3.createApp().use(middleware)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as AddressInfo
    await new Promise<void>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: '/', headers: { host, ...headers } }, (res) => {
        res.resume()
        res.on('end', resolve)
      }).on('error', reject).end()
    })
  }
  finally {
    server.close()
  }
}

afterEach(() => {
  seen.length = 0
})

describe('preview middleware', () => {
  it.each([
    ['preview', '5.preview.knecht.test'],
    ['ide', 'ide--5.preview.knecht.test'],
    ['service', 'mailpit--5.preview.knecht.test'],
  ])('never forwards the internal preview token to the %s upstream', async (proxy, host) => {
    const token = await liveToken()
    expect(token).toHaveLength(64)
    await send(host, { [PREVIEW_AUTH_HEADER]: token })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.proxy).toBe(proxy)
    expect(seen[0]!.headers[PREVIEW_AUTH_HEADER]).toBeUndefined()
  })

  it('still lets the link checker through the login gate', async () => {
    await send('5.preview.knecht.test', { [PREVIEW_AUTH_HEADER]: await liveToken() })
    expect(seen[0]!.internal).toBe(true)
  })

  it('does not let one session\'s token into another session\'s preview', async () => {
    await send('6.preview.knecht.test', { [PREVIEW_AUTH_HEADER]: await liveToken(5) })
    expect(seen[0]!.internal).toBe(false)
  })

  it('treats a wrong token as an anonymous request', async () => {
    await send('5.preview.knecht.test', { [PREVIEW_AUTH_HEADER]: 'f'.repeat(64) })
    expect(seen[0]!.internal).toBe(false)
  })
})
