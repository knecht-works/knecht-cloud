// Requests to a preview host (shared/utils/preview-host.ts) are served
// entirely from that run's isolated ddev environment (see preview-proxy.ts);
// the reserved `ide` label is the run's web IDE instead (ide-proxy.ts).
// Everything else falls through to the normal Knecht app.
export default defineEventHandler(async (event) => {
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  const ref = parsePreviewHost(host)
  if (!ref) return

  if (isIdeLabel(ref.label)) {
    return proxyRunIde(event, ref.runId)
  }
  await proxyRunPreview(event, ref.runId, ref.label)
})
