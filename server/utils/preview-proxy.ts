import { request as httpRequest } from 'node:http'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { runEnvName } from './storage'

// Reverse-proxy a whole request to a RUN's isolated ddev environment
// (projects.md §8). Called from the preview-host middleware for requests to
// `<runId>.preview.<host>` — a per-run origin so the app's ABSOLUTE asset paths
// resolve correctly.
//
// We reach the run's web container DIRECTLY by name (`ddev-<env>-web`) over
// ddev's shared `ddev_default` network, bypassing the ddev router. That means
// the app's own host (e.g. ganzlebendig.ddev.site) is just a Host header — no
// router-hostname collision across isolated runs, and the project keeps using
// the exact URLs from its pasted .env. We then REWRITE that host to the preview
// origin in the response body + Location header, so what the browser loads
// points back here (not at the untrusted-cert *.ddev.site).
//
// Access is login-gated (projects.md §8): the request must carry a valid Knecht
// session, sent cross-subdomain via the base-domain cookie. Logged out: a
// navigation redirects to login (with return-to); subresources get 401.

// Content types whose bodies we rewrite URLs in. Everything else streams as-is.
const REWRITABLE = /text\/html|text\/css|javascript|json|xml|svg|text\/plain/i

export async function proxyRunPreview(event: H3Event, runId: number): Promise<void> {
  const session = await getUserSession(event)
  if (!session?.user) {
    const reqUrl = getRequestURL(event)
    if (!String(getRequestHeader(event, 'accept') ?? '').includes('text/html')) {
      throw createError({ statusCode: 401, statusMessage: 'Login required' })
    }
    const baseHost = reqUrl.host.replace(/^\d+\.preview\./, '')
    setCookie(event, 'knecht-redirect', `${reqUrl.protocol}//${reqUrl.host}${reqUrl.pathname}${reqUrl.search}`, {
      domain: process.env.KNECHT_BASE_DOMAIN || undefined,
      path: '/',
      maxAge: 600,
      sameSite: 'lax',
    })
    return sendRedirect(event, `${reqUrl.protocol}//${baseHost}/login`, 302)
  }

  const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()
  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }
  if (run.envState !== 'up' || !run.previewHost) {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }

  // Keep the idle-stopper from reaping an env that is actively being viewed.
  db.update(schema.runs)
    .set({ previewLastSeen: new Date() })
    .where(eq(schema.runs.id, runId))
    .run()

  const appHost = run.previewHost
  const url = getRequestURL(event)
  const previewOrigin = `${url.protocol}//${url.host}`
  const appOrigin = `http://${appHost}`
  const req = event.node.req
  const res = event.node.res

  // Send the app's own host so it serves/builds URLs as configured, and rewrite
  // Origin/Referer to match — otherwise the app's same-origin checks (Craft's CP
  // login) reject the POST because the browser's Origin (the preview subdomain)
  // wouldn't match the Host. Ask for an uncompressed body so we can rewrite it.
  const headers = { ...req.headers, 'host': appHost, 'accept-encoding': 'identity' }
  if (headers.origin) headers.origin = appOrigin
  if (headers.referer) headers.referer = String(headers.referer).replaceAll(previewOrigin, appOrigin)

  return new Promise<void>((resolve, reject) => {
    const upstream = httpRequest(
      {
        host: `ddev-${runEnvName(runId)}-web`,
        port: 80,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
      },
      (up) => {
        const type = String(up.headers['content-type'] ?? '')
        const rewrite = !up.headers['content-encoding'] && REWRITABLE.test(type)

        res.statusCode = up.statusCode ?? 502
        for (const [key, value] of Object.entries(up.headers)) {
          if (value === undefined) continue
          const lower = key.toLowerCase()
          if (lower === 'x-frame-options') continue
          // Recomputed below for rewritten bodies.
          if (rewrite && (lower === 'content-length' || lower === 'transfer-encoding')) continue
          if (lower === 'location') {
            res.setHeader(key, rewriteUrls(String(value), appHost, previewOrigin, url.host))
            continue
          }
          res.setHeader(key, value)
        }

        if (!rewrite) {
          up.pipe(res)
          up.on('end', () => resolve())
          up.on('error', reject)
          return
        }

        const chunks: Buffer[] = []
        up.on('data', (c: Buffer) => chunks.push(c))
        up.on('end', () => {
          const body = rewriteUrls(Buffer.concat(chunks).toString('utf8'), appHost, previewOrigin, url.host)
          const buf = Buffer.from(body, 'utf8')
          res.setHeader('content-length', String(buf.byteLength))
          res.end(buf)
          resolve()
        })
        up.on('error', reject)
      },
    )
    upstream.on('error', reject)
    req.pipe(upstream)
  })
}

// Replace the app's ddev host with the preview origin. Covers absolute URLs
// (both schemes), protocol-relative, AND the JSON escaped-slash form
// (`https:\/\/host`) that PHP's json_encode emits — that's how Craft ships its
// CP config (Craft.actionUrl, …), and missing it sends CP requests straight to
// the untrusted-cert *.ddev.site. Scheme-full forms are replaced before the
// bare `//host` so the latter only catches genuine protocol-relative URLs.
function rewriteUrls(text: string, host: string, origin: string, hostOnly: string): string {
  const esc = origin.replaceAll('/', '\\/')
  return text
    .replaceAll(`https://${host}`, origin)
    .replaceAll(`http://${host}`, origin)
    .replaceAll(`//${host}`, `//${hostOnly}`)
    .replaceAll(`https:\\/\\/${host}`, esc)
    .replaceAll(`http:\\/\\/${host}`, esc)
    .replaceAll(`\\/\\/${host}`, `\\/\\/${hostOnly}`)
}
