// Preview, IDE and service hosts are left out: the dashboard frames previews itself.
export default defineEventHandler((event) => {
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  if (isPreviewHost(host)) return
  setResponseHeaders(event, {
    'x-frame-options': 'DENY',
    'content-security-policy': 'frame-ancestors \'none\'',
  })
})
