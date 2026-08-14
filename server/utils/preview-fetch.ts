import { Buffer } from 'node:buffer'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isPreviewHost, stripPreviewPrefix } from '../../shared/utils/preview-host'
import { dashboardOrigin } from './origin'

// Server-side workflow steps (link-check) fetch a run's preview URLs like any
// visitor, but carry no browser session, and the preview proxy is
// login-gated. This per-boot token authenticates the instance's OWN requests
// to its OWN preview hosts: previewAwareFetch attaches it (per redirect hop,
// never to a foreign host), the preview proxy accepts it. Random per process
// start and never persisted; the runner and the proxy share the process.

const TOKEN = randomBytes(32).toString('hex')

export const PREVIEW_AUTH_HEADER = 'x-knecht-preview-auth'

export function isPreviewAuthToken(value: string | undefined): boolean {
  if (!value || value.length !== TOKEN.length) return false
  return timingSafeEqual(Buffer.from(value), Buffer.from(TOKEN))
}

// True when the URL points at a preview host OF THIS INSTANCE: the base host
// behind the preview prefix must be ours, so `1.preview.evil.com` never
// receives the token.
export function isOwnPreviewUrl(url: string | URL): boolean {
  const origin = dashboardOrigin()
  if (!origin) return false
  try {
    const u = typeof url === 'string' ? new URL(url) : url
    return isPreviewHost(u.hostname) && stripPreviewPrefix(u.host) === new URL(origin).host
  }
  catch {
    return false
  }
}

const MAX_REDIRECTS = 5

// fetch() that can enter this instance's login-gated previews. Redirects are
// followed manually so the token is re-decided per hop and never travels to
// a host outside our preview namespace.
export async function previewAwareFetch(url: string, init?: Omit<RequestInit, 'redirect'>): Promise<Response> {
  let target = url
  for (let hop = 0; ; hop++) {
    const headers = new Headers(init?.headers)
    if (isOwnPreviewUrl(target)) headers.set(PREVIEW_AUTH_HEADER, TOKEN)
    const res = await fetch(target, { ...init, headers, redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location || hop >= MAX_REDIRECTS) return res
    await res.body?.cancel()
    target = new URL(location, target).href
  }
}
