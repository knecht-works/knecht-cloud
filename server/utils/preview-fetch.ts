import { Buffer } from 'node:buffer'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isPreviewHost, stripPreviewPrefix } from '../../shared/utils/preview-host'
import { dashboardOrigin } from './origin'

const TOKEN = randomBytes(32).toString('hex')

export const PREVIEW_AUTH_HEADER = 'x-knecht-preview-auth'

export function isPreviewAuthToken(value: string | undefined): boolean {
  if (!value || value.length !== TOKEN.length) return false
  return timingSafeEqual(Buffer.from(value), Buffer.from(TOKEN))
}

// The base host behind the preview prefix must be ours, so `1.preview.evil.com` never receives the token.
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

// Redirects are followed manually so the token is re-decided per hop and never leaves our preview hosts.
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
