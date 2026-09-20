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
  // Safe to repeat. Defaults to GET only; a GraphQL query is a read sent as POST.
  idempotent?: boolean
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
      retry: (opts.idempotent ?? method === 'GET') ? 2 : 0,
      retryStatusCodes: [429, 502, 503, 504],
      retryDelay: ({ response }) => retryDelay(response),
    })
  }
}

type VendorFetch<A> = ReturnType<typeof createVendorFetch<A>>

// GraphQL reports most failures in the body of a 200, and sends reads and writes alike as POST.
export function createGraphqlClient<A>(name: string, vendorFetch: VendorFetch<A>, path = '/graphql') {
  async function request<T>(idempotent: boolean, query: string, variables: Record<string, unknown>, auth?: A): Promise<T> {
    const res = await vendorFetch<{ data?: T, errors?: { message?: string }[] }>(path, { method: 'POST', body: { query, variables }, auth, idempotent })
    if (res.errors?.length || !res.data) throw new Error(`${name}: ${res.errors?.map(e => e.message).join('; ') || 'empty response'}`)
    return res.data
  }
  return {
    query: <T>(query: string, variables: Record<string, unknown> = {}, auth?: A) => request<T>(true, query, variables, auth),
    mutate: <T>(query: string, variables: Record<string, unknown> = {}, auth?: A) => request<T>(false, query, variables, auth),
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
