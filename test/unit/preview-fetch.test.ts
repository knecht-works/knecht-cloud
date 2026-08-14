import { describe, expect, it } from 'vitest'
import { isOwnPreviewUrl, isPreviewAuthToken, PREVIEW_AUTH_HEADER, previewAwareFetch } from '../../server/utils/preview-fetch'
import { withServer } from '../helpers/http-server'

// test-env.ts pins KNECHT_BASE_URL=http://knecht.test, so our preview hosts
// are <id>.preview.knecht.test.

describe('isOwnPreviewUrl', () => {
  it('matches only preview hosts on OUR base host', () => {
    expect(isOwnPreviewUrl('http://122.preview.knecht.test/sitemap.xml')).toBe(true)
    expect(isOwnPreviewUrl('http://api--122.preview.knecht.test/')).toBe(true)
    // Foreign base: the preview prefix alone must never earn the token.
    expect(isOwnPreviewUrl('http://122.preview.evil.com/')).toBe(false)
    // The dashboard itself and arbitrary hosts are not preview hosts.
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
    expect(isPreviewAuthToken(undefined)).toBe(false)
    expect(isPreviewAuthToken('')).toBe(false)
    expect(isPreviewAuthToken('a'.repeat(64))).toBe(false)
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
      const res = await previewAwareFetch(`${origin}/from`)
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
      const res = await previewAwareFetch(`${origin}/loop`)
      expect(res.status).toBe(302)
      await res.body?.cancel()
    })
  })
})
