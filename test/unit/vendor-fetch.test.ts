import { describe, expect, it, vi } from 'vitest'
import { createVendorCache, createVendorFetch } from '../../server/integrations/vendor-fetch'
import { withServer } from '../helpers/http-server'

interface Auth {
  origin: string
  token: string
}

function client(auth: Auth | null) {
  return createVendorFetch<Auth>({
    name: 'Tracker',
    credentials: () => auth,
    baseUrl: a => `${a.origin}/api`,
    headers: a => ({ 'X-Token': a.token }),
  })
}

describe('createVendorFetch', () => {
  it('refuses to call a tool that is not connected', async () => {
    await expect(client(null)('/me')).rejects.toThrow('Tracker is not connected')
  })

  it('sends the stored credentials, or the ones being tried', async () => {
    const seen: (string | undefined)[] = []
    await withServer({
      'GET /api/me': (req, res) => {
        seen.push(req.headers['x-token'] as string | undefined)
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true}')
      },
    }, async (origin) => {
      expect(await client({ origin, token: 'stored' })('/me')).toEqual({ ok: true })
      await client(null)('/me', { auth: { origin, token: 'tried' } })
    })
    expect(seen).toEqual(['stored', 'tried'])
  })

  it('repeats a throttled read after the delay the tool asks for', async () => {
    let calls = 0
    await withServer({
      'GET /api/items': (_req, res) => {
        if (++calls === 1) {
          res.statusCode = 429
          res.setHeader('retry-after', '0')
          return res.end()
        }
        res.setHeader('content-type', 'application/json')
        res.end('[1]')
      },
    }, async (origin) => {
      expect(await client({ origin, token: 't' })('/items')).toEqual([1])
    })
    expect(calls).toBe(2)
  })

  it('never repeats a write', async () => {
    let calls = 0
    await withServer({
      'POST /api/comments': (_req, res) => {
        calls++
        res.statusCode = 503
        res.end()
      },
    }, async (origin) => {
      await expect(client({ origin, token: 't' })('/comments', { method: 'POST', body: { text: 'hi' } })).rejects.toThrow()
    })
    expect(calls).toBe(1)
  })
})

describe('createVendorCache', () => {
  it('serves a value until it expires or is forgotten, and never keeps a failure', async () => {
    vi.useFakeTimers()
    const cache = createVendorCache(1000)
    let loads = 0
    const load = () => cache.cached('k', async () => ++loads)

    expect(await load()).toBe(1)
    expect(await load()).toBe(1)
    vi.advanceTimersByTime(1001)
    expect(await load()).toBe(2)
    cache.forget()
    expect(await load()).toBe(3)

    await expect(cache.cached('bad', async () => {
      throw new Error('down')
    })).rejects.toThrow('down')
    expect(await cache.cached('bad', async () => 'back')).toBe('back')
    vi.useRealTimers()
  })
})
