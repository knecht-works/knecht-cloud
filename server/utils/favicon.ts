import { request } from 'node:http'
import type { Project } from '#server/db/schema'
import { setProjectMeta } from '#server/stores/projects'
import { previewTargetPort, readDdevConfig, readDdevHosts } from '#server/daemon/ddev'
import { resolvePreview } from '#server/daemon/sandbox'
import { sessionPreviewUrl } from '#server/utils/preview-target'
import { sessionCheckoutDir } from '#server/utils/storage'
import { getSessionRow } from '#server/stores/sessions'

const MAX_HTML_BYTES = 512_000

const FAVICON_MAX_BYTES = 200_000
const FAVICON_MIME_BY_EXT: Record<string, string> = {
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
    const dir = sessionCheckoutDir(sessionId)
    // The app sees the host the preview proxy sends, and a dev server may refuse any other.
    const host = session.urlMode === 'env' ? new URL(preview).host : readDdevHosts(dir).primary ?? new URL(preview).host
    // A headless CMS serves only the backend on the preview port; its frontend
    // and the favicon it declares live on one of the extra exposed ports.
    const ports = new Set([previewTargetPort(session), ...(readDdevConfig(dir)?.extraPorts ?? []).map(p => p.port)])
    for (const port of ports) {
      const favicon = await faviconFrom(addr, port, host)
      if (favicon) return save(project.id, favicon)
    }
  }
  catch {
    // Best-effort.
  }
}

async function faviconFrom(addr: string, port: number, host: string): Promise<string | null> {
  const page = await fetchFrom(addr, port, host, '/', MAX_HTML_BYTES)
  const href = page ? iconHref(page.body.toString('utf8')) : null

  if (href?.startsWith('data:image/')) return href

  // Whatever host the href names, the fetch stays inside the web container:
  // the hostname only becomes the Host header.
  const iconUrl = new URL(href ?? '/favicon.ico', `http://${host}/`)
  const icon = await fetchFrom(addr, port, iconUrl.host, `${iconUrl.pathname}${iconUrl.search}`, FAVICON_MAX_BYTES)
  if (!icon?.body.byteLength) return null
  // Nitro's dev server answers /favicon.ico for an app without one with the text
  // of a 1x1 GIF data URI, labelled image/x-icon: no favicon, try again later.
  if (icon.body.subarray(0, 5).toString() === 'data:') return null
  const mime = icon.contentType?.split(';')[0]?.trim()
    || FAVICON_MIME_BY_EXT[iconUrl.pathname.split('.').pop()?.toLowerCase() ?? '']
  if (!mime?.startsWith('image/')) return null
  return `data:${mime};base64,${icon.body.toString('base64')}`
}

function save(projectId: number, favicon: string): void {
  setProjectMeta(projectId, { favicon })
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

export async function fetchFrom(
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
