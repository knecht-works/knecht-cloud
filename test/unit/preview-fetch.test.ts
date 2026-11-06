import { describe, expect, it, vi } from 'vitest'
import { isOwnPreviewUrl, isPreviewAuthToken, PREVIEW_AUTH_HEADER, previewAwareFetch } from '../../server/utils/preview-fetch'
import { withServer } from '../helpers/http-server'

describe('isOwnPreviewUrl', () => {
  it('matches only preview hosts on OUR base host', () => {
    expect(isOwnPreviewUrl('http://122.preview.knecht.test/sitemap.xml')).toBe(true)
    expect(isOwnPreviewUrl('http://api--122.preview.knecht.test/')).toBe(true)
    expect(isOwnPreviewUrl('http://122.preview.evil.com/')).toBe(false)
    expect(isOwnPreviewUrl('http://knecht.test/')).toBe(false)
    expect(isOwnPreviewUrl('https://example.com/')).toBe(false)
    expect(isOwnPreviewUrl('not a url')).toBe(false)
  })

  it('demands the exact base host including the port', () => {
    expect(isOwnPreviewUrl('http://122.preview.knecht.test:8080/')).toBe(false)
  })
})

describe('isPreviewAuthToken', () => {
  it('rejects wrong and empty values', () => {
    expect(isPreviewAuthToken(undefined, 5)).toBe(false)
    expect(isPreviewAuthToken('', 5)).toBe(false)
    expect(isPreviewAuthToken('a'.repeat(64), 5)).toBe(false)
  })
})

describe('previewAwareFetch', () => {
  it('sends no auth header to non-preview hosts and follows redirects', async () => {
    const seen: (string | undefined)[] = []
    await withServer({
      'GET /from': (req, res) => {
        seen.push(req.headers[PREVIEW_AUTH_HEADER] as string | undefined)
        res.statusCode = 302
        res.setHeader('location', '/to')
        res.end()
      },
      'GET /to': (req, res) => {
        seen.push(req.headers[PREVIEW_AUTH_HEADER] as string | undefined)
        res.end('ok')
      },
    }, async (origin) => {
      const res = await previewAwareFetch(`${origin}/from`, 5)
      expect(res.status).toBe(200)
      expect(seen).toEqual([undefined, undefined])
    })
  })

  it('gives up after the redirect cap instead of looping', async () => {
    await withServer({
      'GET /loop': (_req, res) => {
        res.statusCode = 302
        res.setHeader('location', '/loop')
        res.end()
      },
    }, async (origin) => {
      const res = await previewAwareFetch(`${origin}/loop`, 5)
      expect(res.status).toBe(302)
      await res.body?.cancel()
    })
  })
})

describe('preview auth token', () => {
  async function sentHeaders(url: string, sessionId: number): Promise<(string | null)[]> {
    const sent: (string | null)[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers).get(PREVIEW_AUTH_HEADER))
      return new Response('')
    })
    try {
      await previewAwareFetch(url, sessionId)
    }
    finally {
      vi.unstubAllGlobals()
    }
    return sent
  }

  it('goes only to the hosts of the fetching session', async () => {
    const [own] = await sentHeaders('http://5.preview.knecht.test/', 5)
    const [label] = await sentHeaders('http://api--5.preview.knecht.test/', 5)
    const [other] = await sentHeaders('http://6.preview.knecht.test/', 5)
    expect(own).toHaveLength(64)
    expect(label).toBe(own)
    expect(other).toBeNull()
  })

  it('opens only the session it was issued for', async () => {
    const [token] = await sentHeaders('http://5.preview.knecht.test/', 5)
    expect(isPreviewAuthToken(token!, 5)).toBe(true)
    expect(isPreviewAuthToken(token!, 6)).toBe(false)
  })
})
