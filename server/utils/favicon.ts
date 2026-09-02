import { request } from 'node:http'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import { readDdevHosts } from '../daemon/ddev'
import { resolvePreview } from '../daemon/sandbox'
import { getSessionRow } from './entities'
import { sessionPreviewUrl } from './preview-target'
import { sessionCheckoutDir } from './storage'

// Fallback favicon source for projects whose repo scan found none: once a
// run's preview is browsable (ddev-start), read the site's <head> for its
// icon link and store the icon as a data URI on the project. Covers sites
// whose icon is generated at build time, hashed, or served by the CMS and
// therefore never sits in the repo as a favicon.* file. Best-effort and
// fire-and-forget: any failure just keeps the generic project icon.

const MAX_HTML_BYTES = 512_000

// Shared with the repo-scan favicon lookup (utils/github.ts): one icon size
// cap and one extension-to-MIME map, wherever the icon comes from.
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
    // The site's own hostname; a generated environment has none, its dev
    // server answers to the preview host on the session's pinned port.
    const port = session.previewPort ?? 80
    const primary = readDdevHosts(sessionCheckoutDir(sessionId)).primary ?? new URL(preview).host

    const page = await fetchFrom(addr, port, primary, '/', MAX_HTML_BYTES)
    const href = page ? iconHref(page.body.toString('utf8')) : null

    // A head that inlines its icon as a data URI is already what we store.
    if (href?.startsWith('data:image/')) return save(project.id, href)

    // Resolve the href (relative or absolute) against the site. Whatever host
    // it names, the fetch stays inside the run's web container (fetchFrom
    // connects to its address, the hostname only becomes the Host header): a
    // canonical domain the site serves in rewrite mode works, and a CDN host
    // the container doesn't serve just fails the fetch or the image check.
    const iconUrl = new URL(href ?? '/favicon.ico', `http://${primary}/`)
    const icon = await fetchFrom(addr, port, iconUrl.hostname, `${iconUrl.pathname}${iconUrl.search}`, FAVICON_MAX_BYTES)
    if (!icon?.body.byteLength) return
    const mime = icon.contentType?.split(';')[0]?.trim()
      || FAVICON_MIME_BY_EXT[iconUrl.pathname.split('.').pop()?.toLowerCase() ?? '']
    if (!mime?.startsWith('image/')) return
    save(project.id, `data:${mime};base64,${icon.body.toString('base64')}`)
  }
  catch {
    // Best-effort only.
  }
}

function save(projectId: number, favicon: string): void {
  db.update(schema.projects)
    .set({ favicon })
    .where(eq(schema.projects.id, projectId))
    .run()
}

// The document's icon link. rel is matched by token so "shortcut icon" and
// "icon" hit but "mask-icon" (monochrome Safari glyph) doesn't; a plain icon
// wins over apple-touch-icon, which is the fallback.
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

// GET a path from the run's web container (plain HTTP on the preview port,
// the Host header selects the site, exactly like the preview proxy). Follows
// same-project redirects a few hops (e.g. / → /en/); resolves null on errors,
// 4xx/5xx or oversized bodies instead of throwing.
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
    // The redirect target may be absolute (the site's own host, whatever the
    // scheme) or relative; either way the sandbox serves it on the same port.
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
