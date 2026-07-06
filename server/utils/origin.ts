// The dashboard's public origin, for URLs built SERVER-side (PR bodies,
// webhook endpoints, anywhere no request URL is at hand). Prod sets
// KNECHT_BASE_DOMAIN and https is implied; dev, where scheme and port differ
// (http://lvh.me:3333), overrides with the full KNECHT_BASE_URL.
export function dashboardOrigin(): string {
  const url = process.env.KNECHT_BASE_URL
  if (url) return url.replace(/\/+$/, '')
  const domain = process.env.KNECHT_BASE_DOMAIN
  return domain ? `https://${domain}` : ''
}

// The preview origin a run's primary host is served under, or null when no
// base origin is configured.
export function previewOrigin(runId: number): string | null {
  const origin = dashboardOrigin()
  if (!origin) return null
  const url = new URL(origin)
  return `${url.protocol}//${previewHostname(runId, url.host)}`
}
