import { request as httpRequest } from 'node:http'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { IDE_DEFAULT_SETTINGS, IDE_PORT } from '../daemon/ide'
import { resolvePreview, forgetPreview } from '../daemon/sandbox'
import { isMember, memberCount } from './members'

// The web IDE's origin: `ide--<runId>.preview.<host>` (the label `ide` is
// reserved; a project ddev hostname that would map to it loses, which no real
// hostname does in practice). Unlike app previews nothing is rewritten or
// injected: openvscode-server speaks same-origin URLs natively. Two legs:
//
//   HTTP: proxyRunIde, wired into the preview middleware like app previews.
//   WebSocket: the workbench lives on ws connections with arbitrary paths, so
//   route-based ws handlers can't serve it. wrapWebsocketResolve intercepts
//   h3's ws route resolution (the cached `websocket.resolve` every crossws
//   adapter consults, dev and prod) and returns pipe-through hooks for IDE
//   origins; everything else falls through to the normal route resolution.
//
// Both legs gate on the same session + membership check as app previews and
// bump the idle clock, so an open IDE keeps its environment alive.

const IDE_LABEL = 'ide'

function bumpPreviewSeen(runId: number): void {
  db.update(schema.runs).set({ previewLastSeen: new Date() }).where(eq(schema.runs.id, runId)).run()
}

// ── HTTP leg ──────────────────────────────────────────────────────────────────

export async function proxyRunIde(event: H3Event, runId: number): Promise<void> {
  const session = await getUserSession(event)
  // Never let the session read WRITE a session (see preview-proxy.ts).
  removeResponseHeader(event, 'set-cookie')
  if (!session?.user) {
    // Same logged-out handling as app previews: browser navigations bounce to
    // the login page and return here via the knecht-redirect cookie; anything
    // else (workbench XHRs, websockets' HTTP fallbacks) gets the bare 401.
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
  if (memberCount() > 0 && !isMember(session.user.login)) {
    await clearUserSession(event)
    throw createError({ statusCode: 403, statusMessage: 'Membership revoked' })
  }

  const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  if (run.envState !== 'up') {
    throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })
  }
  const ip = await resolvePreview(runId)
  if (!ip) throw createError({ statusCode: 503, statusMessage: 'Environment is not running' })

  bumpPreviewSeen(runId)

  const url = getRequestURL(event)
  const req = event.node.req
  const res = event.node.res
  // The workbench DOCUMENT gets buffered so the IDE defaults can be injected
  // into its embedded configuration; everything else streams as-is.
  const wantsHtml = String(getRequestHeader(event, 'accept') ?? '').includes('text/html')
  const headers = { ...req.headers }
  if (wantsHtml) headers['accept-encoding'] = 'identity'
  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest(
      { host: ip, port: IDE_PORT, method: req.method, path: `${url.pathname}${url.search}`, headers },
      (up) => {
        const isHtml = /text\/html/i.test(String(up.headers['content-type'] ?? ''))
        const buffer = wantsHtml && isHtml && !up.headers['content-encoding']
        res.statusCode = up.statusCode ?? 502
        for (const [key, value] of Object.entries(up.headers)) {
          if (value === undefined) continue
          if (buffer && (key.toLowerCase() === 'content-length' || key.toLowerCase() === 'transfer-encoding')) continue
          res.setHeader(key, value)
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
          const body = Buffer.from(injectIdeDefaults(Buffer.concat(chunks).toString('utf8')), 'utf8')
          res.setHeader('content-length', String(body.byteLength))
          res.end(body)
          resolve()
        })
        up.on('error', reject)
      },
    )
    upstream.on('error', (e) => {
      forgetPreview(runId)
      reject(e)
    })
    req.pipe(upstream)
  }).catch((e: NodeJS.ErrnoException) => {
    if (e?.code === 'ECONNREFUSED' || e?.code === 'EHOSTUNREACH' || e?.code === 'ETIMEDOUT') {
      throw createError({ statusCode: 503, statusMessage: 'The IDE is not running. Open it from the run page.' })
    }
    throw e
  })
}

// The workbench HTML carries its whole boot configuration in one meta tag
// (`vscode-workbench-web-configuration`, attribute-escaped JSON). The web
// workbench registers default overrides ONLY from the TOP-LEVEL
// `configurationDefaults` key of these construction options
// (vs/workbench/services/configuration/browser/configuration.ts); a
// `productConfiguration.configurationDefaults` reaches the product service but
// nothing in the web client reads it. So: decode, merge the IDE defaults into
// the top-level key (defaults only: the user's own browser-side settings still
// win), re-encode.
const decodeAttr = (v: string): string => v.replaceAll('&quot;', '"').replaceAll('&amp;', '&')
const encodeAttr = (v: string): string => v.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

function injectIdeDefaults(html: string): string {
  return html.replace(
    /(id="vscode-workbench-web-configuration"[^>]*data-settings=")([^"]*)(")/,
    (match, pre: string, encoded: string, post: string) => {
      try {
        const cfg = JSON.parse(decodeAttr(encoded)) as { configurationDefaults?: Record<string, unknown> }
        cfg.configurationDefaults = {
          ...cfg.configurationDefaults,
          ...IDE_DEFAULT_SETTINGS,
        }
        return pre + encodeAttr(JSON.stringify(cfg)) + post
      }
      catch {
        // Not the JSON we expected: serve it untouched rather than break the IDE.
        return match
      }
    },
  )
}

// ── WebSocket leg ─────────────────────────────────────────────────────────────

// The upgrade request shapes differ per adapter (node vs dev): read the Host
// header defensively from whatever carries it.
function upgradeHost(source: { headers?: unknown, request?: { headers?: unknown } }): string {
  const headers = source.headers ?? source.request?.headers
  if (!headers) return ''
  if (headers instanceof Headers) return headers.get('host') ?? ''
  return String((headers as Record<string, unknown>).host ?? '')
}

function ideRunRef(source: { headers?: unknown, request?: { headers?: unknown } }): number | null {
  const host = upgradeHost(source).split(':')[0] ?? ''
  const ref = parsePreviewHost(host)
  return ref?.label === IDE_LABEL ? ref.runId : null
}

interface Pipe {
  backend: WebSocket
  // Client frames arriving before the backend socket opens are queued.
  queue: (string | Uint8Array<ArrayBuffer>)[]
  runId: number
  lastBump: number
}
const pipes = new Map<string, Pipe>()

// crossws hooks piping every frame between the browser and the container's
// IDE server. Frame types must be preserved: the workbench protocol is binary.
const ideWsHooks = {
  async upgrade(request: { headers?: unknown, url?: string }) {
    const session = await getUserSession(request as Parameters<typeof getUserSession>[0])
    if (!session?.user) {
      throw createError({ statusCode: 401, statusMessage: 'Login required' })
    }
    if (memberCount() > 0 && !isMember(session.user.login)) {
      throw createError({ statusCode: 403, statusMessage: 'Membership revoked' })
    }
    const runId = ideRunRef(request)
    const run = runId === null
      ? null
      : db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()
    if (!run || run.envState !== 'up') {
      throw createError({ statusCode: 409, statusMessage: 'Environment is not running' })
    }
  },

  async open(peer: { id: string, request?: { url?: string, headers?: unknown }, send: (data: unknown) => void, close: (code?: number, reason?: string) => void }) {
    const runId = ideRunRef(peer.request ?? {})
    const ip = runId === null ? null : await resolvePreview(runId)
    if (runId === null || !ip) return peer.close(1011, 'Environment is not running')
    const path = (() => {
      try {
        const url = new URL(peer.request?.url ?? '/', 'http://localhost')
        return `${url.pathname}${url.search}`
      }
      catch {
        return '/'
      }
    })()
    const backend = new WebSocket(`ws://${ip}:${IDE_PORT}${path}`)
    backend.binaryType = 'arraybuffer'
    const pipe: Pipe = { backend, queue: [], runId, lastBump: 0 }
    pipes.set(peer.id, pipe)
    backend.onopen = () => {
      for (const frame of pipe.queue) backend.send(frame)
      pipe.queue = []
    }
    backend.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      peer.send(typeof e.data === 'string' ? e.data : new Uint8Array(e.data))
    }
    backend.onclose = () => peer.close()
    backend.onerror = () => peer.close(1011, 'IDE connection failed')
  },

  message(peer: { id: string }, message: { rawData?: unknown, text: () => string, uint8Array: () => Uint8Array }) {
    const pipe = pipes.get(peer.id)
    if (!pipe) return
    const data = message.uint8Array() as Uint8Array<ArrayBuffer>
    if (pipe.backend.readyState === WebSocket.OPEN) pipe.backend.send(data)
    else pipe.queue.push(data)
    const now = Date.now()
    if (now - pipe.lastBump > 30_000) {
      pipe.lastBump = now
      bumpPreviewSeen(pipe.runId)
    }
  },

  close(peer: { id: string }) {
    const pipe = pipes.get(peer.id)
    pipes.delete(peer.id)
    if (pipe && pipe.backend.readyState <= WebSocket.OPEN) pipe.backend.close()
  },
}

// Intercept h3's cached websocket route resolution: IDE-origin upgrades get
// the pipe-through hooks, everything else (the run terminal, future ws
// routes) resolves normally. Called once from a nitro plugin.
export function wrapWebsocketResolve(h3App: { websocket: { resolve: (info: never) => unknown } }): void {
  const ws = h3App.websocket
  const original = ws.resolve.bind(ws)
  ws.resolve = (info: never) => {
    if (ideRunRef(info) !== null) return ideWsHooks
    return original(info)
  }
}

export function isIdeLabel(label: string | undefined): boolean {
  return label === IDE_LABEL
}
