// Requests to `<runId>.preview.<host>` are served entirely from that run's
// isolated ddev environment (see preview-proxy.ts). Everything else falls
// through to the normal Knecht app. This per-run origin is what makes the app's
// absolute asset paths resolve in the iframe.
export default defineEventHandler(async (event) => {
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  const match = /^(\d+)\.preview\./.exec(host)
  if (!match) return

  await proxyRunPreview(event, Number(match[1]))
})
