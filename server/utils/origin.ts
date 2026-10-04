import { previewHostname } from '../../shared/utils/preview-host'

export function dashboardOrigin(): string {
  const url = process.env.KNECHT_BASE_URL
  if (url) return url.replace(/\/+$/, '')
  const domain = process.env.KNECHT_BASE_DOMAIN
  return domain ? `https://${domain}` : ''
}

// The previews are the same site as the dashboard, so SameSite cookies do not
// stop them: cookie-authenticated requests check the Origin browsers send.
export function isForeignOrigin(origin: string | null | undefined, host: string): boolean {
  if (!origin) return false
  try {
    return new URL(origin).host !== host
  }
  catch {
    return true
  }
}

export function previewOrigin(sessionId: number, label?: string): string | null {
  const origin = dashboardOrigin()
  if (!origin) return null
  const url = new URL(origin)
  return `${url.protocol}//${previewHostname(sessionId, url.host, label)}`
}

export function withPreviewFooter(body: string, sessionId: number): string {
  const origin = previewOrigin(sessionId)
  if (!origin) return body
  const footer = `**Preview:** ${origin}`
  return body.trim() ? `${body.trim()}\n\n---\n${footer}` : footer
}
