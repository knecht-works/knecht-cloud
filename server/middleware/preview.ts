// Requests to `[<label>--]<runId>.preview.<host>` are served entirely from
// that run's isolated ddev environment (see preview-proxy.ts). Everything else
// falls through to the normal Knecht app. Each of the project's ddev hostnames
// gets its own per-run preview origin: the plain `<runId>.` form is the
// primary host, `<label>--<runId>.` addresses an additional hostname (Craft
// multisite etc.) — which is what makes each site's ABSOLUTE URLs resolve.
export default defineEventHandler(async (event) => {
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  const match = /^(?:([a-z0-9-]+)--)?(\d+)\.preview\./.exec(host)
  if (!match) return

  await proxyRunPreview(event, Number(match[2]), match[1])
})
