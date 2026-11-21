import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { isPreviewHost, parsePreviewHost, stripPreviewPrefix } from '#shared/utils/preview-host'
import { dashboardOrigin } from '#server/utils/origin'
import { deriveKey } from '#server/utils/crypto'

export const PREVIEW_AUTH_HEADER = 'x-knecht-preview-auth'

export function agentCookieName(sessionId: number): string {
  return `knecht-agent-${sessionId}`
}

// Long enough for one agent turn, which writes a fresh token into the sandbox when it starts.
export const PREVIEW_AUTH_TTL_S = 12 * 60 * 60

// A copy that reaches session code opens only that session's own preview, and only until it expires.
export function previewAuthToken(sessionId: number, expiresAt = Math.floor(Date.now() / 1000) + PREVIEW_AUTH_TTL_S): string {
  return `${expiresAt}.${tokenMac(sessionId, expiresAt)}`
}

export function isPreviewAuthToken(value: string | undefined, sessionId: number): boolean {
  const [expires = '', mac = ''] = value?.split('.') ?? []
  const expiresAt = Number(expires)
  if (!/^\d+$/.test(expires) || expiresAt <= Date.now() / 1000) return false
  const expected = tokenMac(sessionId, expiresAt)
  return mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
}

function tokenMac(sessionId: number, expiresAt: number): string {
  return createHmac('sha256', deriveKey('knecht-preview-auth', 'hmac-token')).update(`${sessionId}.${expiresAt}`).digest('hex')
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
export async function previewAwareFetch(url: string, sessionId: number, init?: Omit<RequestInit, 'redirect'>): Promise<Response> {
  let target = url
  for (let hop = 0; ; hop++) {
    const headers = new Headers(init?.headers)
    if (isOwnPreviewUrl(target) && parsePreviewHost(new URL(target).hostname)?.sessionId === sessionId) {
      headers.set(PREVIEW_AUTH_HEADER, previewAuthToken(sessionId))
    }
    const res = await fetch(target, { ...init, headers, redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location || hop >= MAX_REDIRECTS) return res
    await res.body?.cancel()
    target = new URL(location, target).href
  }
}
