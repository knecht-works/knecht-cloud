const PREVIEW_HOST_RE = /^(?:([a-z0-9-]+)--)?(\d+)\.preview\./

interface PreviewHostRef {
  sessionId: number
  label?: string
}

export function parsePreviewHost(host: string): PreviewHostRef | null {
  const match = PREVIEW_HOST_RE.exec(host)
  if (!match) return null
  return { sessionId: Number(match[2]), label: match[1] }
}

export function isPreviewHost(host: string): boolean {
  return PREVIEW_HOST_RE.test(host)
}

export function stripPreviewPrefix(host: string): string {
  return host.replace(PREVIEW_HOST_RE, '')
}

export function previewHostname(sessionId: number, baseHost: string, label?: string): string {
  return `${label ? `${label}--` : ''}${sessionId}.preview.${baseHost}`
}

export function previewLabel(ddevHost: string): string {
  return ddevHost.replace(/\.ddev\.site$/, '').replaceAll('.', '-')
}

// A project must not use this as its preview port, or the forwarder would forward to itself.
export const PREVIEW_FORWARD_PORT = 41000
