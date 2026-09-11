import { request } from 'node:http'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import { previewTargetPort, readDdevHosts } from '../daemon/ddev'
import { resolvePreview } from '../daemon/sandbox'
import { getSessionRow } from './entities'
import { sessionPreviewUrl } from './preview-target'
import { sessionCheckoutDir } from './storage'

const MAX_HTML_BYTES = 512_000

export const FAVICON_MAX_BYTES = 200_000
export const FAVICON_MIME_BY_EXT: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export async function detectPreviewFavicon(sessionId: number, project: Project): Promise<void> {
  if (project.favicon) return
  try {
    const addr = await resolvePreview(sessionId)
    const session = getSessionRow(sessionId)
    const preview = session && sessionPreviewUrl(session)
    if (!addr || !preview) return
    const port = previewTargetPort(session)
    const primary = readDdevHosts(sessionCheckoutDir(sessionId)).primary ?? new URL(preview).host

    const page = await fetchFrom(addr, port, primary, '/', MAX_HTML_BYTES)
    const href = page ? iconHref(page.body.toString('utf8')) : null

    if (href?.startsWith('data:image/')) return save(project.id, href)

    // Whatever host the href names, the fetch stays inside the web container:
    // the hostname only becomes the Host header.
    const iconUrl = new URL(href ?? '/favicon.ico', `http://${primary}/`)
    const icon = await fetchFrom(addr, port, iconUrl.hostname, `${iconUrl.pathname}${iconUrl.search}`, FAVICON_MAX_BYTES)
    if (!icon?.body.byteLength) return
    const mime = icon.contentType?.split(';')[0]?.trim()
      || FAVICON_MIME_BY_EXT[iconUrl.pathname.split('.').pop()?.toLowerCase() ?? '']
    if (!mime?.startsWith('image/')) return
    save(project.id, `data:${mime};base64,${icon.body.toString('base64')}`)
  }
  catch {
    // Best-effort.
  }
}

function save(projectId: number, favicon: string): void {
  db.update(schema.projects)
    .set({ favicon })
    .where(eq(schema.projects.id, projectId))
    .run()
}

function iconHref(html: string): string | null {
  let appleTouch: string | null = null
  for (const link of html.match(/<link\s[^>]*>/gi) ?? []) {
    const rel = /rel\s*=\s*["']?([^"'>]*)/i.exec(link)?.[1]?.toLowerCase().split(/\s+/) ?? []
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue
    const href = /href\s*=\s*["']?([^"'\s>]+)/i.exec(link)?.[1]
    if (!href) continue
    if (rel.includes('icon')) return href
    appleTouch ??= href
  }
  return appleTouch
}

async function fetchFrom(
  addr: string,
  port: number,
  host: string,
  path: string,
  maxBytes: number,
  hops = 3,
): Promise<{ body: Buffer, contentType: string | null } | null> {
  const res = await new Promise<{ body: Buffer, contentType: string | null, location: string | null } | null>((resolve) => {
    const req = request(
      { host: addr, port, path, headers: { host, accept: '*/*' }, timeout: 10_000 },
      (up) => {
        const status = up.statusCode ?? 500
        const location = status >= 300 && status < 400 ? String(up.headers.location ?? '') || null : null
        if (status >= 400) {
          up.resume()
          return resolve(null)
        }
        const chunks: Buffer[] = []
        let size = 0
        up.on('data', (c: Buffer) => {
          size += c.byteLength
          if (size > maxBytes) {
            req.destroy()
            resolve(null)
          }
          else chunks.push(c)
        })
        up.on('end', () => resolve({
          body: Buffer.concat(chunks),
          contentType: up.headers['content-type'] ?? null,
          location,
        }))
        up.on('error', () => resolve(null))
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end()
  })
  if (!res) return null
  if (res.location && hops > 0) {
    try {
      const url = new URL(res.location, `http://${host}${path}`)
      return fetchFrom(addr, port, url.hostname, `${url.pathname}${url.search}`, maxBytes, hops - 1)
    }
    catch {
      return null
    }
  }
  return res.location ? null : res
}
