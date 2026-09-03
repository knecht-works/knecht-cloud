// The preview-host naming scheme, the ONE place that knows it (used by the
// app's preview links, the host middlewares and the preview proxy):
//
//   [<label>--]<sessionId>.preview.<base>
//
// Every hostname a run's ddev environment serves gets a per-run preview
// origin: the primary host as the plain `<sessionId>.` form, each additional
// one under a label derived from it (run-isolation.md §10/3). The session id
// picks the
// sandbox; the label picks the host INSIDE it, so parallel runs of the same
// project coexist without the project's own hostnames ever colliding.

const PREVIEW_HOST_RE = /^(?:([a-z0-9-]+)--)?(\d+)\.preview\./

interface PreviewHostRef {
  sessionId: number
  /** Present for an additional (non-primary) hostname's origin. */
  label?: string
}

// Parse an incoming Host (port already stripped) into its run reference, or
// null when it isn't a preview host at all.
export function parsePreviewHost(host: string): PreviewHostRef | null {
  const match = PREVIEW_HOST_RE.exec(host)
  if (!match) return null
  return { sessionId: Number(match[2]), label: match[1] }
}

export function isPreviewHost(host: string): boolean {
  return PREVIEW_HOST_RE.test(host)
}

// The dashboard's own host, recovered from a preview host (e.g. to send a
// logged-out visitor back to the login page). Ports survive.
export function stripPreviewPrefix(host: string): string {
  return host.replace(PREVIEW_HOST_RE, '')
}

// Build the preview hostname for a run on the given base host (`lvh.me:3333`,
// `preview.example.com`, …). No label → the primary host's origin.
export function previewHostname(sessionId: number, baseHost: string, label?: string): string {
  return `${label ? `${label}--` : ''}${sessionId}.preview.${baseHost}`
}

// The label for one of the project's ddev hostnames: the default `.ddev.site`
// suffix is dropped, remaining dots become dashes (they'd end the DNS label).
// `knaus.kta.ddev.site` → `knaus-kta`. Reverse lookup is by comparison against
// the project's host set, never by parsing the label back.
export function previewLabel(ddevHost: string): string {
  return ddevHost.replace(/\.ddev\.site$/, '').replaceAll('.', '-')
}

// The container port a dev server's preview is reached on: not the port the
// server listens on (that may be localhost only) but the forwarder next to
// it (daemon/ddev.ts). A project must not pick it as its preview port, or
// the forwarder would forward to itself.
export const PREVIEW_FORWARD_PORT = 41000
