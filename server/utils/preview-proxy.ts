import { request as httpRequest } from 'node:http'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { readDdevHosts, type DdevHosts } from '../daemon/ddev'
import { resolvePreview, forgetPreview } from '../daemon/sandbox'
import { runWorktreeDir } from './storage'

// Reverse-proxy a whole request to a RUN's isolated environment (projects.md
// §8). Called from the preview-host middleware for requests to
// `[<label>--]<runId>.preview.<host>`.
//
// The contract is: the operator pastes the project's local .env VERBATIM and
// everything runs as it does with plain ddev — hard-coded `*.ddev.site` URLs,
// multisite setups with one domain per site, all of it, nothing overridden.
// So the proxy maps between the two worlds instead of touching the project:
//
//   - EVERY hostname the project's ddev config serves (primary +
//     additional_hostnames/additional_fqdns — readDdevHosts) gets its own
//     per-run preview origin: the primary as `<runId>.preview.<base>`, each
//     additional one as `<label>--<runId>.preview.<base>`.
//   - Inward, the request carries the project's REAL host (so e.g. Craft
//     matches the right site), targeting the sandbox's inner ddev-router at
//     :80 over plain HTTP (run-isolation.md §3/§11).
//   - Outward, every project host found in Location headers and rewritable
//     bodies is replaced with ITS preview origin — cross-site links included —
//     so what the browser loads always points back here (not at the
//     unreachable *.ddev.site).
//
// Access is login-gated (projects.md §8): the request must carry a valid Knecht
// session, sent cross-subdomain via the base-domain cookie. Logged out: a
// navigation redirects to login (with return-to); subresources get 401.

// Content types whose bodies we rewrite URLs in. Everything else streams as-is.
const REWRITABLE = /text\/html|text\/css|javascript|json|xml|svg|text\/plain/i

export async function proxyRunPreview(event: H3Event, runId: number, label?: string): Promise<void> {
  const session = await getUserSession(event)
  if (!session?.user) {
    const reqUrl = getRequestURL(event)
    if (!String(getRequestHeader(event, 'accept') ?? '').includes('text/html')) {
      throw createError({ statusCode: 401, statusMessage: 'Login required' })
    }
    const baseHost = reqUrl.host.replace(/^(?:[a-z0-9-]+--)?\d+\.preview\./, '')
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
  if (run.envState !== 'up') {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }

  const hosts = runHosts(runId)
  const appHost = label
    ? hosts.all.find(h => labelFor(h) === label)
    : hosts.primary
  if (!appHost) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown preview host' })
  }

  const sandboxAddr = await resolvePreview(runId)
  if (!sandboxAddr) {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }

  // Keep the idle-stopper from reaping an env that is actively being viewed.
  db.update(schema.runs)
    .set({ previewLastSeen: new Date() })
    .where(eq(schema.runs.id, runId))
    .run()

  const url = getRequestURL(event)
  // `<runId>.preview.<base>[:port]` — the label-less part of the request host;
  // every project host's preview origin is built from it.
  const baseHost = label ? url.host.slice(label.length + 2) : url.host
  // Longest first so a host that contains another as a suffix (knaus.kta.…
  // vs kta.…) is never half-rewritten by the shorter one.
  const mappings = hosts.all
    .sort((a, b) => b.length - a.length)
    .map(h => ({
      host: h,
      previewHost: h === hosts.primary ? baseHost : `${labelFor(h)}--${baseHost}`,
    }))
  const req = event.node.req
  const res = event.node.res

  // Send the app's own host so it serves/builds URLs as configured, and map
  // Origin/Referer back to the app's world — otherwise same-origin checks
  // (Craft's CP login) reject the POST because the browser's Origin (the
  // preview subdomain) wouldn't match the Host. Ask for an uncompressed body
  // so we can rewrite it.
  const headers = { ...req.headers, 'host': appHost, 'accept-encoding': 'identity' }
  for (const key of ['origin', 'referer'] as const) {
    if (!headers[key]) continue
    let value = String(headers[key])
    for (const m of mappings) {
      value = value.replaceAll(`${url.protocol}//${m.previewHost}`, `http://${m.host}`)
    }
    headers[key] = value
  }

  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest(
      {
        host: sandboxAddr,
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
          // The Knecht UI embeds previews in an iframe.
          if (lower === 'x-frame-options') continue
          // Recomputed below for rewritten bodies.
          if (rewrite && (lower === 'content-length' || lower === 'transfer-encoding')) continue
          if (lower === 'location') {
            res.setHeader(key, rewriteUrls(String(value), mappings, url.protocol))
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
          const body = rewriteUrls(Buffer.concat(chunks).toString('utf8'), mappings, url.protocol)
          const buf = Buffer.from(body, 'utf8')
          res.setHeader('content-length', String(buf.byteLength))
          res.end(buf)
          resolve()
        })
        up.on('error', reject)
      },
    )
    upstream.on('error', (e) => {
      // A rebooted sandbox gets a fresh IP — drop the cached one so the next
      // request re-resolves instead of failing against a stale address.
      forgetPreview(runId)
      reject(e)
    })
    req.pipe(upstream)
  }).catch((e: NodeJS.ErrnoException) => {
    // The sandbox is up but nothing answers on :80 yet — the inner router
    // appears a few moments into `ddev start` (or the boot failed). Surface a
    // clean "not ready" instead of a raw socket error.
    if (e?.code === 'ECONNREFUSED' || e?.code === 'EHOSTUNREACH' || e?.code === 'ETIMEDOUT') {
      throw createError({ statusCode: 503, statusMessage: 'Environment is starting or failed to boot' })
    }
    throw e
  })
}

// The subdomain label for one of the project's hosts: the default `.ddev.site`
// suffix is dropped, remaining dots become dashes (they'd end the DNS label).
// `knaus.kta.ddev.site` → `knaus-kta`. Reverse lookup is by comparison, never
// by parsing the label back.
function labelFor(host: string): string {
  return host.replace(/\.ddev\.site$/, '').replaceAll('.', '-')
}

// Replace every project host with ITS preview origin. Covers absolute URLs
// (both schemes), protocol-relative, AND the JSON escaped-slash form
// (`https:\/\/host`) that PHP's json_encode emits — that's how Craft ships its
// CP config (Craft.actionUrl, …), and missing it sends CP requests straight to
// the unreachable *.ddev.site. Scheme-full forms are replaced before the bare
// `//host` so the latter only catches genuine protocol-relative URLs.
function rewriteUrls(
  text: string,
  mappings: { host: string, previewHost: string }[],
  protocol: string,
): string {
  for (const { host, previewHost } of mappings) {
    const origin = `${protocol}//${previewHost}`
    const esc = origin.replaceAll('/', '\\/')
    text = text
      .replaceAll(`https://${host}`, origin)
      .replaceAll(`http://${host}`, origin)
      .replaceAll(`//${host}`, `//${previewHost}`)
      .replaceAll(`https:\\/\\/${host}`, esc)
      .replaceAll(`http:\\/\\/${host}`, esc)
      .replaceAll(`\\/\\/${host}`, `\\/\\/${previewHost}`)
  }
  return text
}

// The project's ddev host set, read from the run's worktree once and cached —
// it is fixed for the run's lifetime.
const hostsCache = new Map<number, DdevHosts>()

function runHosts(runId: number): DdevHosts {
  let hosts = hostsCache.get(runId)
  if (!hosts || !hosts.all.length) {
    hosts = readDdevHosts(runWorktreeDir(runId))
    hostsCache.set(runId, hosts)
  }
  return hosts
}
