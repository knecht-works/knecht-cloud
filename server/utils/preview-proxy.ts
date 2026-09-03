import { request as httpRequest } from 'node:http'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { previewTargetPort, readDdevHosts, type DdevHosts } from '../daemon/ddev'
import { resolvePreview, forgetPreview } from '../daemon/sandbox'
import { looksLikeDevServerLabel, verifyDevServerLabel } from './dev-origin'
import { isMember, memberCount } from './members'
import { sessionCheckoutDir } from './storage'

// Reverse-proxy a whole request to a SESSION's isolated environment
// (projects.md §8). Called from the preview-host middleware for requests to
// `[<label>--]<sessionId>.preview.<host>`. EVERY hostname the project's ddev
// config serves (primary + additional_hostnames/additional_fqdns, via
// readDdevHosts) gets its own per-session preview origin: the primary as
// `<sessionId>.preview.<base>`, each additional one as
// `<label>--<sessionId>.preview.<base>`.
//
// TWO MODES, pinned per session (sessions.urlMode, from the project
// setting):
//
//   'env' (default): the project derives all its URLs from env vars, and the
//   run's env was already translated to the preview origins at boot
//   (daemon/ddev.ts). The app natively speaks preview URLs, so this proxy is
//   a plain pass-through: original Host, original bodies, streaming. Only the
//   iframe concerns remain (frame headers stripped, bridge script injected
//   into HTML documents).
//
//   'rewrite' (compatibility): the operator pastes the project's local .env
//   VERBATIM and everything runs as it does with plain ddev: hard-coded
//   `*.ddev.site` URLs, multisite setups with one domain per site, nothing
//   overridden. The proxy maps between the two worlds instead of touching
//   the project: inward, the request carries the project's REAL host (so
//   e.g. Craft matches the right site); outward, every project host found in
//   Location headers and rewritable bodies is replaced with ITS preview
//   origin (cross-site links included), so what the browser loads always
//   points back here (not at the unreachable *.ddev.site).
//
// Either way the target is the run's web container over plain HTTP: its
// nginx on :80 (serves any Host header; daemon/sandbox.ts), or the forwarder
// in front of the project's dev server (daemon/ddev.ts previewTargetPort):
// on the plain origin of a generated environment, where the dev server IS
// the site, and on the dev origin `dev-<token>--<sessionId>` next to a repo's
// own hostnames (utils/dev-origin.ts). Neither has a hostname of its own, so
// the preview host itself is the app host and passes through unchanged.
//
// Access is login-gated (projects.md §8): the request must carry a valid Knecht
// session, sent cross-subdomain via the base-domain cookie. Logged out: a
// navigation redirects to login (with return-to); subresources get 401. The
// dev origin is the one exception: the site's pages load it as module
// scripts, which the browser fetches WITHOUT cookies across origins, so its
// hostname carries a per-session token instead and a request on a verified
// dev label passes the gate. An unverified `dev-` label is no host at all.

// Content types whose bodies we rewrite URLs in. Everything else streams as-is.
const REWRITABLE = /text\/html|text\/css|javascript|json|xml|svg|text\/plain/i

// Injected into every proxied HTML document so the dashboard's embedded
// preview behaves like a browser: the frame reports each navigation to its
// parent (address bar) and takes back/forward/reload/go commands from it
// (KPreviewBrowser.vue). Both directions are pinned to the dashboard origin,
// which the script recovers from its own preview host.
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

// Add the bridge right after <head> so it is listening before the app's own
// scripts run; documents without a head get it appended (still executes).
function injectBridge(html: string): string {
  const openHead = /<head[^>]*>/i.exec(html)
  if (openHead) {
    const at = openHead.index + openHead[0].length
    return html.slice(0, at) + BRIDGE_SCRIPT + html.slice(at)
  }
  return html + BRIDGE_SCRIPT
}

export async function proxyRunPreview(event: H3Event, sessionId: number, label?: string): Promise<void> {
  // The instance's own server-side fetches (the link-check step) carry the
  // per-boot preview auth token instead of a browser session
  // (utils/preview-fetch.ts); they skip the login gate.
  const internal = isPreviewAuthToken(getRequestHeader(event, PREVIEW_AUTH_HEADER))
  const devOrigin = looksLikeDevServerLabel(label)
  if (devOrigin && !verifyDevServerLabel(sessionId, label)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown preview host' })
  }
  const session = await getUserSession(event)
  // Reading the session must never WRITE one: for a request without a session
  // cookie, getUserSession seeds an empty session and emits a domain-scoped
  // Set-Cookie. Preview pages routinely make credential-less requests (fonts
  // and scripts loaded crossorigin=anonymous, CORS preflights), and that
  // empty cookie would overwrite the operator's live session domain-wide,
  // logging them out of the dashboard.
  removeResponseHeader(event, 'set-cookie')
  if (!internal && !devOrigin) {
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

    // Same per-request re-check as the /api gate (server/middleware/auth.ts):
    // removing a member must also revoke their still-valid session cookie here.
    if (memberCount() > 0 && !isMember(session.user.login)) {
      await clearUserSession(event)
      throw createError({ statusCode: 403, statusMessage: 'Membership revoked' })
    }
  }

  const env = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()
  if (!env) {
    throw createError({ statusCode: 404, statusMessage: 'Session not found' })
  }
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

  // Keep the idle-stopper from reaping an env that is actively being viewed.
  db.update(schema.sessions)
    .set({ previewLastSeen: new Date() })
    .where(eq(schema.sessions.id, sessionId))
    .run()

  const baseHost = stripPreviewPrefix(url.host)
  // 'env' sessions boot with their env already translated to the preview
  // origins; sessions from before the setting existed (null) carry a
  // verbatim env.
  const rewriteMode = (env.urlMode ?? 'rewrite') === 'rewrite'
  // Longest first so a host that contains another as a suffix (knaus.kta.…
  // vs kta.…) is never half-rewritten by the shorter one.
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
    // Send the app's own host so it serves/builds URLs as configured, and map
    // Origin/Referer back to the app's world. Otherwise same-origin checks
    // (Craft's CP login) reject the POST because the browser's Origin (the
    // preview subdomain) wouldn't match the Host. Ask for an uncompressed
    // body so we can rewrite it.
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
    // Pass-through mode touches nothing except HTML documents (the iframe
    // bridge below must be injectable, so they need to arrive uncompressed).
    headers['accept-encoding'] = 'identity'
  }

  const corsOrigin = devOrigin ? sessionCorsOrigin(req.headers.origin, sessionId, baseHost) : null

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
        // Pass-through mode only ever buffers HTML documents, for the bridge.
        const buffer = rewrite || (!rewriteMode && isHtml && !up.headers['content-encoding'])

        res.statusCode = up.statusCode ?? 502
        for (const [key, value] of Object.entries(up.headers)) {
          if (value === undefined) continue
          const lower = key.toLowerCase()
          // The Knecht UI embeds previews in an iframe.
          if (lower === 'x-frame-options') continue
          // Same for a CSP frame-ancestors directive (Craft's CP sends
          // `frame-ancestors 'self'`): drop just that directive, keep the
          // rest of the policy.
          if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') {
            const values = (Array.isArray(value) ? value : [String(value)])
              .map(v => v.replace(/frame-ancestors[^;]*(;\s*|$)/i, '').trim())
              .filter(Boolean)
            if (values.length) res.setHeader(key, values)
            continue
          }
          // Recomputed below for buffered bodies.
          if (buffer && (lower === 'content-length' || lower === 'transfer-encoding')) continue
          if (rewriteMode && lower === 'location') {
            res.setHeader(key, rewriteUrls(String(value), mappings, url.protocol))
            continue
          }
          if (corsOrigin && lower === 'access-control-allow-origin') continue
          res.setHeader(key, value)
        }
        if (corsOrigin) {
          res.setHeader('access-control-allow-origin', corsOrigin)
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
      // A rebooted sandbox gets a fresh IP: drop the cached one so the next
      // request re-resolves instead of failing against a stale address.
      forgetPreview(sessionId)
      reject(e)
    })
    req.pipe(upstream)
  }).catch((e: NodeJS.ErrnoException) => {
    // The sandbox is up but nothing answers on the port yet: the web server
    // appears a few moments into `ddev start` (or the boot failed). Surface a
    // clean "not ready" instead of a raw socket error.
    if (e?.code === 'ECONNREFUSED' || e?.code === 'EHOSTUNREACH' || e?.code === 'ETIMEDOUT') {
      throw createError({ statusCode: 503, statusMessage: 'Environment is starting or failed to boot' })
    }
    throw e
  })
}

// Replace every project host with ITS preview origin, whatever the textual
// form: absolute URLs (both schemes), protocol-relative, the JSON
// escaped-slash form (`https:\/\/host`) PHP's json_encode emits (Craft ships
// its CP config that way) at ANY escaping depth (`https:\\\/\\\/host` when
// JSON is nested in a JSON string, e.g. Craft's element editor settings with
// the live-preview targets), and the percent-encoded form URLs take inside
// query strings. Scheme-full forms adopt the preview protocol; protocol-
// relative ones stay relative (they follow the page's scheme anyway). The
// replacement mirrors the matched slash (with its backslashes), so the
// rewritten URL keeps the surrounding encoding intact.
function rewriteUrls(
  text: string,
  mappings: { host: string, previewHost: string }[],
  protocol: string,
): string {
  for (const { host, previewHost } of mappings) {
    const h = host.replaceAll('.', '\\.')
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

// The project's ddev host set, read from the run's checkout once and cached:
// it is fixed for the run's lifetime. An empty set (a generated environment)
// is re-read on every request, which is one small file.
const hostsCache = new Map<number, DdevHosts>()

// CORS for the dev origin: the site's pages on the session's other preview
// origins load it as module scripts, which the browser only runs with an
// Access-Control-Allow-Origin naming the page's origin. Vite's default policy
// allows localhost only and a repo's own names its ddev hosts, so the proxy
// answers for the session's own preview origins (and only those): the dev
// server needs no config change for it, the way the allowed-host variable
// spares it one (daemon/ddev.ts). Anonymous requests only, so no
// credentials header is ever granted.
function sessionCorsOrigin(origin: string | undefined, sessionId: number, baseHost: string): string | null {
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

function sessionHosts(sessionId: number): DdevHosts {
  let hosts = hostsCache.get(sessionId)
  if (!hosts || !hosts.all.length) {
    hosts = readDdevHosts(sessionCheckoutDir(sessionId))
    hostsCache.set(sessionId, hosts)
  }
  return hosts
}
