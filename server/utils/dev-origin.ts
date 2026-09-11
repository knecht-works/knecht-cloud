import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { previewOrigin } from './origin'

// Module scripts and HMR are fetched crossorigin=anonymous, so no cookie reaches
// the dev origin; the token in the label is the capability instead.

const DEV_LABEL_PREFIX = 'dev-'
const TOKEN_HEX_CHARS = 32
// Exact shape, not the prefix: a repo's own `dev-api.ddev.site` also labels as
// `dev-...` and must keep resolving as a project hostname.
const DEV_LABEL_RE = /^dev-[0-9a-f]{32}$/

let cachedKey: Buffer | undefined
function devOriginKey(): Buffer {
  if (cachedKey) return cachedKey
  const password = process.env.NUXT_SESSION_PASSWORD
  if (!password || password.length < 32) {
    throw new Error('NUXT_SESSION_PASSWORD must be set (≥ 32 chars) to derive the dev origin key')
  }
  cachedKey = Buffer.from(hkdfSync('sha256', password, 'knecht-dev-origin', 'hmac-token', 32))
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
