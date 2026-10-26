import { createHmac, timingSafeEqual } from 'node:crypto'
import { deriveKey } from './crypto'
import { previewOrigin } from './origin'
import { parsePreviewHost, previewHostname, stripPreviewPrefix } from '../../shared/utils/preview-host'

// The label is public (on-demand certificates land in CT logs), so it only
// names the dev origin; access still requires the login like every preview host.

const DEV_LABEL_PREFIX = 'dev-'
const TOKEN_HEX_CHARS = 32
// Exact shape, not the prefix: a repo's own `dev-api.ddev.site` also labels as
// `dev-...` and must keep resolving as a project hostname.
const DEV_LABEL_RE = /^dev-[0-9a-f]{32}$/

let cachedKey: Buffer | undefined
function devOriginKey(): Buffer {
  if (cachedKey) return cachedKey
  cachedKey = deriveKey('knecht-dev-origin', 'hmac-token')
  return cachedKey
}

export function devServerLabel(sessionId: number): string {
  const token = createHmac('sha256', devOriginKey()).update(`dev-server-${sessionId}`).digest('hex')
  return `${DEV_LABEL_PREFIX}${token.slice(0, TOKEN_HEX_CHARS)}`
}

export function looksLikeDevServerLabel(label: string | undefined): label is string {
  return label !== undefined && DEV_LABEL_RE.test(label)
}

export function verifyDevServerLabel(sessionId: number, label: string | undefined): boolean {
  if (!looksLikeDevServerLabel(label)) return false
  const expected = Buffer.from(devServerLabel(sessionId))
  const given = Buffer.from(label)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function devServerOrigin(sessionId: number): string | null {
  return previewOrigin(sessionId, devServerLabel(sessionId))
}

// Only the session's own preview origins may read the dev origin with credentials.
export function devServerCorsOrigin(origin: string | undefined, sessionId: number, baseHost: string): string | null {
  if (!origin) return null
  let host: string
  try {
    host = new URL(origin).host
  }
  catch {
    return null
  }
  const ref = parsePreviewHost(host)
  return ref?.sessionId === sessionId && stripPreviewPrefix(host) === baseHost ? origin : null
}

// Module scripts and modulepreloads load in CORS mode, which sends cookies only
// same-origin; use-credentials lets the login cookie reach the dev origin.
// Their imports inherit the mode, so marking the entry tags covers the whole graph.
export function credentialDevServerTags(html: string, sessionId: number, baseHost: string): string {
  const devHost = previewHostname(sessionId, baseHost, devServerLabel(sessionId))
  return html.replace(/<(?:script|link)\b[^>]*>/gi, (tag) => {
    const isModule = attr(tag, 'type') === 'module' || attr(tag, 'rel') === 'modulepreload'
    const url = attr(tag, 'src') ?? attr(tag, 'href')
    if (!isModule || urlHost(url) !== devHost) return tag
    // Browsers keep the first of two duplicate attributes, so this wins over an existing crossorigin.
    return tag.replace(/^<\w+/, '$& crossorigin="use-credentials"')
  })
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function urlHost(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url, 'http://relative.invalid').host
  }
  catch {
    return null
  }
}
