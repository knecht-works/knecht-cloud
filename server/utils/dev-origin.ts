import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { previewOrigin } from './origin'

// The preview origin of a session's dev server when it runs NEXT to the
// repo's own web server (daemon/ddev.ts): `dev-<token>--<sessionId>.preview.
// <base>`, routed to the forwarder in front of the dev server while the
// project's hostnames keep reaching the web server on :80.
//
// The token is a capability, not decoration. The site's pages load the dev
// server as `<script type="module" src="https://dev-…/@vite/client">`;
// module scripts (and every import behind them, and Vite's HMR updates) are
// fetched crossorigin=anonymous, so the browser sends NO cookie to that
// other origin and the preview's login gate (preview-proxy.ts) would answer
// 401 to each of them. No response header can make the browser attach a
// cookie in anonymous mode, and the tag comes from the repo's Vite plugin.
// So the hostname itself carries the proof: a per-session HMAC that only
// reaches the container's environment (KNECHT_DEV_SERVER_URL) and the HTML
// logged-in users see. Its own key and message, never the agent bridge
// token (that one authorizes pushes and PRs). 128 bits keep the label at 36
// chars, under the 63-char DNS label limit.

const DEV_LABEL_PREFIX = 'dev-'
const TOKEN_HEX_CHARS = 32
// The exact shape, not the prefix: a repo's own `dev.example.com` or
// `dev-api.ddev.site` also label as `dev-…` (previewLabel), and those must
// keep resolving as the project's hostnames.
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

// Whether a preview label has the shape of a dev origin, verified or not:
// the proxies answer 404 to one that does not verify instead of treating it
// as one of the project's hostnames.
export function looksLikeDevServerLabel(label: string | undefined): label is string {
  return label !== undefined && DEV_LABEL_RE.test(label)
}

export function verifyDevServerLabel(sessionId: number, label: string | undefined): boolean {
  if (!looksLikeDevServerLabel(label)) return false
  const expected = Buffer.from(devServerLabel(sessionId))
  const given = Buffer.from(label)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// Null without a configured base origin (utils/origin.ts).
export function devServerOrigin(sessionId: number): string | null {
  return previewOrigin(sessionId, devServerLabel(sessionId))
}
