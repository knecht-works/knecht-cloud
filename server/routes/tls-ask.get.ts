// Caddy's on_demand_tls "ask" endpoint (see Caddyfile): 200 means "issue a
// certificate for this hostname", any error status means refuse. This is the
// abuse guard Let's Encrypt issuance hangs on: without it, anyone resolving a
// random subdomain of the preview wildcard could drain the weekly certificate
// quota. Public by design (Caddy calls it unauthenticated); it lives outside
// /api/ so the session gate in server/middleware/auth.ts skips it, and it
// leaks nothing beyond whether a run id exists.
export default defineEventHandler((event) => {
  const domain = String(getQuery(event).domain ?? '').toLowerCase()
  const base = (process.env.KNECHT_BASE_DOMAIN || '').toLowerCase()
  if (!base || !domain) throw createError({ statusCode: 404 })

  if (domain === base) return 'ok'

  // Only the canonical form [<label>--]<runId>.preview.<base> of an existing
  // run qualifies; reconstruct and compare so nothing sneaks in around it.
  const ref = parsePreviewHost(domain)
  if (!ref || !getRun(ref.runId)) throw createError({ statusCode: 404 })
  if (domain !== previewHostname(ref.runId, base, ref.label)) throw createError({ statusCode: 404 })
  return 'ok'
})
