import { ofetch } from 'ofetch'

interface VendorFetchDef<A> {
  name: string
  credentials(): A | null
  baseUrl(auth: A): string
  headers(auth: A): Record<string, string>
}

export interface VendorRequest<A> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  // Credentials to try before they are saved; the stored connection otherwise.
  auth?: A
}

// A webhook delivery waits for these calls, so a tool that hangs or throttles must not hold it for long.
const TIMEOUT_MS = 15_000
const MAX_RETRY_DELAY_MS = 10_000

function retryDelay(response: Response | undefined): number {
  const header = response?.headers.get('retry-after')
  const seconds = Number(header)
  if (!header || !Number.isFinite(seconds)) return 500
  return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
}

// ofetch instead of $fetch: the URL is an external site, not a Nitro route.
export function createVendorFetch<A>(def: VendorFetchDef<A>) {
  return async function vendorFetch<T>(path: string, opts: VendorRequest<A> = {}): Promise<T> {
    const auth = opts.auth ?? def.credentials()
    if (!auth) throw new Error(`${def.name} is not connected`)
    const method = opts.method ?? 'GET'
    return await ofetch<T>(`${def.baseUrl(auth)}${path}`, {
      method,
      body: opts.body,
      headers: { Accept: 'application/json', ...def.headers(auth) },
      timeout: TIMEOUT_MS,
      // Only reads are repeated: a repeated write could post a comment twice.
      retry: method === 'GET' ? 2 : 0,
      retryStatusCodes: [429, 502, 503, 504],
      retryDelay: ({ response }) => retryDelay(response),
    })
  }
}

export function createVendorCache(ttlMs: number) {
  const memo = new Map<string, { at: number, value: Promise<unknown> }>()
  return {
    cached<T>(key: string, load: () => Promise<T>): Promise<T> {
      const hit = memo.get(key)
      if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
      const value = load().catch((e) => {
        memo.delete(key)
        throw e
      })
      memo.set(key, { at: Date.now(), value })
      return value
    },
    forget(): void {
      memo.clear()
    },
  }
}
