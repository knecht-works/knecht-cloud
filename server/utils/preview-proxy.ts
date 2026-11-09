import { request as httpRequest } from 'node:http'
import type { H3Event } from 'h3'
import { previewTargetPort, readDdevHosts, type DdevHosts } from '../daemon/ddev'
import { resolvePreview, forgetPreview } from '../daemon/sandbox'
import { credentialDevServerTags, devServerCorsOrigin, looksLikeDevServerLabel, verifyDevServerLabel } from './dev-origin'
import { sessionMember } from './member-session'
import { sessionCheckoutDir } from './storage'
import { getSessionRow, touchSessionPreview } from '../stores/sessions'
import { envTransition, reviveEnv } from '../daemon/envs'
import { guestAllowed, shareCookieName, shareTokenValid } from './preview-share'
import { SHARE_PARAM } from '../../shared/utils/preview-access'
import type { Session } from '../db/schema'

// Two URL modes per session (sessions.urlMode), see internals/docs/preview-contract.md.

const REWRITABLE = /text\/html|text\/css|javascript|json|xml|svg|text\/plain/i

const BRIDGE_SCRIPT = `<script>(function () {
  if (window === window.parent) return
  var dash = location.protocol + '//' + location.host.replace(/^(?:[a-z0-9-]+--)?\\d+\\.preview\\./, '')
  addEventListener('message', function (e) {
    var d = e.data || {}
    if (e.origin !== dash || d.knecht !== 'cmd') return
    if (d.action === 'back') history.back()
    else if (d.action === 'forward') history.forward()
    else if (d.action === 'reload') location.reload()
    else if (d.action === 'go' && typeof d.url === 'string') location.href = d.url
  })
  parent.postMessage({ knecht: 'nav', href: location.href, title: document.title }, dash)
})()</script>`

function injectBridge(html: string): string {
  const openHead = /<head[^>]*>/i.exec(html)
  if (openHead) {
    const at = openHead.index + openHead[0].length
    return html.slice(0, at) + BRIDGE_SCRIPT + html.slice(at)
  }
  return html + BRIDGE_SCRIPT
}

const KNECHT_COOKIE = /^(?:nuxt-session|knecht-share-\d+)=/

export function withoutKnechtCookies(header: string | undefined): string | undefined {
  return header?.split(';').map(c => c.trim()).filter(c => c && !KNECHT_COOKIE.test(c)).join('; ') || undefined
}

export async function proxyRunPreview(event: H3Event, sessionId: number, label: string | undefined, internal: boolean, shareCookie?: string): Promise<void> {
  const devOrigin = looksLikeDevServerLabel(label)
  if (devOrigin && !verifyDevServerLabel(sessionId, label)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown preview host' })
  }
  const session = await getUserSession(event)
  // getUserSession seeds an empty session cookie for cookie-less requests
  // (crossorigin=anonymous fonts, preflights); domain-wide, that would log the
  // operator out of the dashboard.
  removeResponseHeader(event, 'set-cookie')
  // Browsers never send cookies with a preflight, so it is answered here and never reaches the dev server.
  if (devOrigin && event.method === 'OPTIONS' && getRequestHeader(event, 'access-control-request-method')) {
    return answerDevServerPreflight(event, sessionId)
  }
  const env = getSessionRow(sessionId)
  const shared = getQuery(event)[SHARE_PARAM]
  if (env && typeof shared === 'string') return acceptShareLink(event, env, shared, !!session?.user)
  if (!internal && !(env && guestAllowed(env, shareCookie))) {
    if (!session?.user) {
      const reqUrl = getRequestURL(event)
      if (!String(getRequestHeader(event, 'accept') ?? '').includes('text/html')) {
        throw createError({ statusCode: 401, statusMessage: 'Login required' })
      }
      const baseHost = stripPreviewPrefix(reqUrl.host)
      setCookie(event, 'knecht-redirect', `${reqUrl.protocol}//${reqUrl.host}${reqUrl.pathname}${reqUrl.search}`, {
        domain: process.env.KNECHT_BASE_DOMAIN || undefined,
        path: '/',
        maxAge: 600,
        sameSite: 'lax',
      })
      return sendRedirect(event, `${reqUrl.protocol}//${baseHost}/login`, 302)
    }

    // Same re-check as server/middleware/auth.ts: a removed member's cookie is still valid.
    if (!sessionMember(session)) {
      await clearUserSession(event)
      throw createError({ statusCode: 403, statusMessage: 'Membership revoked' })
    }
  }

  if (!env) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }
  if (env.envState === 'stopped' || env.envState === 'archived') return wakePreview(event, sessionId)
  if (env.envState !== 'up') {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }

  const url = getRequestURL(event)
  const hosts = sessionHosts(sessionId)
  const appHost = devOrigin
    ? url.host
    : label
      ? hosts.all.find(h => previewLabel(h) === label)
      : hosts.primary ?? url.host
  if (!appHost) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown preview host' })
  }

  const sandboxAddr = await resolvePreview(sessionId)
  if (!sandboxAddr) {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }

  touchSessionPreview(sessionId)

  const baseHost = stripPreviewPrefix(url.host)
  const rewriteMode = (env.urlMode ?? 'rewrite') === 'rewrite'
  // Longest first so a host that has another as a suffix is never half-rewritten.
  const mappings = hosts.all
    .sort((a, b) => b.length - a.length)
    .map(h => ({
      host: h,
      previewHost: previewHostname(sessionId, baseHost, h === hosts.primary ? undefined : previewLabel(h)),
    }))
  const req = event.node.req
  const res = event.node.res

  const headers = { ...req.headers }
  if (rewriteMode) {
    // Origin/Referer are mapped too: Craft's CP login rejects a POST whose Origin
    // does not match the Host. identity encoding so the body can be rewritten.
    headers['host'] = appHost
    headers['accept-encoding'] = 'identity'
    for (const key of ['origin', 'referer'] as const) {
      if (!headers[key]) continue
      let value = String(headers[key])
      for (const m of mappings) {
        value = value.replaceAll(`${url.protocol}//${m.previewHost}`, `http://${m.host}`)
      }
      headers[key] = value
    }
  }
  else if (String(headers['accept'] ?? '').includes('text/html')) {
    // HTML must arrive uncompressed for the bridge injection.
    headers['accept-encoding'] = 'identity'
  }

  const corsOrigin = devOrigin ? devServerCorsOrigin(req.headers.origin, sessionId, baseHost) : null

  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest(
      {
        host: sandboxAddr,
        port: previewTargetPort(env, devOrigin),
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (up) => {
        const type = String(up.headers['content-type'] ?? '')
        const isHtml = /text\/html/i.test(type)
        const rewrite = rewriteMode && !up.headers['content-encoding'] && REWRITABLE.test(type)
        const buffer = rewrite || (!rewriteMode && isHtml && !up.headers['content-encoding'])

        res.statusCode = up.statusCode ?? 502
        for (const [key, value] of Object.entries(up.headers)) {
          if (value === undefined) continue
          const lower = key.toLowerCase()
          if (lower === 'x-frame-options') continue
          if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
            const values = (Array.isArray(value) ? value : [String(value)])
              .map(v => v.replace(/frame-ancestors[^;]*(;\s*|$)/i, '').trim())
              .filter(Boolean)
            if (values.length) res.setHeader(key, values)
            continue
          }
          if (buffer && (lower === 'content-length' || lower === 'transfer-encoding')) continue
          if (rewriteMode && lower === 'location') {
            res.setHeader(key, rewriteUrls(String(value), mappings, url.protocol))
            continue
          }
          if (corsOrigin && (lower === 'access-control-allow-origin' || lower === 'access-control-allow-credentials')) continue
          res.setHeader(key, value)
        }
        if (corsOrigin) {
          res.setHeader('access-control-allow-origin', corsOrigin)
          res.setHeader('access-control-allow-credentials', 'true')
          const vary = [up.headers.vary].flat().filter(Boolean).map(String)
          if (!vary.some(v => /\borigin\b/i.test(v))) vary.push('Origin')
          res.setHeader('vary', vary.join(', '))
        }

        if (!buffer) {
          up.pipe(res)
          up.on('end', () => resolve())
          up.on('error', reject)
          return
        }

        const chunks: Buffer[] = []
        up.on('data', (c: Buffer) => chunks.push(c))
        up.on('end', () => {
          let body = Buffer.concat(chunks).toString('utf8')
          if (rewrite) body = rewriteUrls(body, mappings, url.protocol)
          if (isHtml && !devOrigin) body = credentialDevServerTags(body, sessionId, baseHost)
          if (isHtml) body = injectBridge(body)
          const buf = Buffer.from(body, 'utf8')
          res.setHeader('content-length', String(buf.byteLength))
          res.end(buf)
          resolve()
        })
        up.on('error', reject)
      },
    )
    upstream.on('error', (e) => {
      forgetPreview(sessionId)
      reject(e)
    })
    req.pipe(upstream)
  }).catch((e: NodeJS.ErrnoException) => {
    if (e?.code === 'ECONNREFUSED' || e?.code === 'EHOSTUNREACH' || e?.code === 'ETIMEDOUT') {
      throw createError({ statusCode: 503, statusMessage: 'Environment is starting or failed to boot' })
    }
    throw e
  })
}

// The token moves into a cookie on all of the session's preview hosts and leaves the
// URL, so the app never sees it and the address bar can be copied on without it.
function acceptShareLink(event: H3Event, env: Session, token: string, member: boolean): Promise<void> {
  const url = getRequestURL(event)
  if (shareTokenValid(env, token)) {
    const domain = process.env.KNECHT_BASE_DOMAIN
    setCookie(event, shareCookieName(env.id), token, {
      domain: domain ? `preview.${domain}` : undefined,
      path: '/',
      expires: env.shareExpiresAt!,
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'lax',
    })
  }
  else if (!member) {
    throw createError({ statusCode: 410, statusMessage: 'This share link has expired' })
  }
  url.searchParams.delete(SHARE_PARAM)
  return sendRedirect(event, url.toString(), 302)
}

const WAKING_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>Starting preview</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#0b0b0c;color:#d4d4d8}p{margin:0;max-width:28rem;padding:0 16px;text-align:center}</style></head><body><p>This preview was asleep and is starting now. The page reloads by itself once it is ready, which can take a few minutes.</p></body></html>`

function wakePreview(event: H3Event, sessionId: number): Promise<void> {
  if (!envTransition(sessionId)) {
    reviveEnv(sessionId).catch(e => console.error(`[preview] waking session ${sessionId} failed:`, e))
  }
  if (!String(getRequestHeader(event, 'accept') ?? '').includes('text/html')) {
    throw createError({ statusCode: 503, statusMessage: 'Environment is starting' })
  }
  setResponseStatus(event, 503)
  setResponseHeaders(event, { 'retry-after': 10, 'cache-control': 'no-store' })
  return send(event, WAKING_PAGE, 'text/html; charset=utf-8')
}

// Also matches PHP json_encode's escaped slashes (`https:\/\/host`) at any
// nesting depth and the percent-encoded form inside query strings; the
// replacement mirrors the matched slash so the surrounding encoding survives.
function rewriteUrls(
  text: string,
  mappings: { host: string, previewHost: string }[],
  protocol: string,
): string {
  for (const { host, previewHost } of mappings) {
    const h = RegExp.escape(host)
    text = text
      .replace(
        new RegExp(`(https?:)?((?:\\\\+)?/)(?:\\\\+)?/${h}`, 'gi'),
        (_, scheme: string | undefined, slash: string) =>
          `${scheme ? protocol : ''}${slash}${slash}${previewHost}`,
      )
      .replace(
        new RegExp(`https?%3A%2F%2F${h}`, 'gi'),
        `${protocol.slice(0, -1)}%3A%2F%2F${previewHost.replace(':', '%3A')}`,
      )
  }
  return text
}

const hostsCache = new Map<number, DdevHosts>()

function answerDevServerPreflight(event: H3Event, sessionId: number): void {
  const corsOrigin = devServerCorsOrigin(getRequestHeader(event, 'origin'), sessionId, stripPreviewPrefix(getRequestURL(event).host))
  if (!corsOrigin) throw createError({ statusCode: 403, statusMessage: 'Cross-origin request refused' })
  setResponseHeaders(event, {
    'access-control-allow-origin': corsOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': getRequestHeader(event, 'access-control-request-method') ?? '',
    'access-control-allow-headers': getRequestHeader(event, 'access-control-request-headers') ?? '',
    'vary': 'Origin',
  })
  setResponseStatus(event, 204)
  event.node.res.end()
}

function sessionHosts(sessionId: number): DdevHosts {
  let hosts = hostsCache.get(sessionId)
  if (!hosts || !hosts.all.length) {
    hosts = readDdevHosts(sessionCheckoutDir(sessionId))
    hostsCache.set(sessionId, hosts)
  }
  return hosts
}
