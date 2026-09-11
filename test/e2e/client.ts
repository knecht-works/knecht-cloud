import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { previewHostname } from '../../shared/utils/preview-host'

export const BASE_URL = (process.env.KNECHT_E2E_BASE_URL ?? 'http://lvh.me:3333').replace(/\/+$/, '')

export interface E2eClient {
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  login: string
  cookie: string
}

export async function login(): Promise<E2eClient> {
  const secret = process.env.KNECHT_TEST_AUTH
  if (!secret) {
    throw new Error('Set KNECHT_TEST_AUTH to the dev-login secret of the target instance (and KNECHT_E2E_BASE_URL to its origin)')
  }
  const res = await fetch(`${BASE_URL}/_test/login?secret=${encodeURIComponent(secret)}`)
  if (!res.ok) {
    throw new Error(`Dev login at ${BASE_URL}/_test/login failed: ${res.status} ${res.statusText}`)
  }
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const { login } = await res.json() as { login: string }
  return {
    login,
    cookie,
    fetch: (path, init = {}) => fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { cookie, ...init.headers },
    }),
  }
}

export interface PreviewResponse {
  status: number
  body: string
  location?: string
}

// Preview hosts are wildcard subdomains a CI runner cannot resolve, so the preview origin
// travels in the Host header. node:http because fetch controls the Host header.
export function previewFetch(
  runId: number,
  opts: { label?: string, path?: string, cookie?: string, accept?: string } = {},
): Promise<PreviewResponse> {
  const base = new URL(BASE_URL)
  const https = base.protocol === 'https:'
  return new Promise((resolve, reject) => {
    const req = (https ? httpsRequest : httpRequest)(
      {
        hostname: base.hostname,
        port: base.port || (https ? 443 : 80),
        path: opts.path ?? '/',
        headers: {
          host: previewHostname(runId, base.host, opts.label),
          accept: opts.accept ?? 'text/html',
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        // A connection dropped mid-body errors on the RESPONSE stream, not the request.
        res.on('error', reject)
        res.on('data', c => chunks.push(c))
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString(),
          location: res.headers.location,
        }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

export async function expectJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url} -> ${res.status}: ${await res.text()}`)
  return await res.json() as T
}
