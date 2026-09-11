export default defineEventHandler(async (event) => {
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  const ref = parsePreviewHost(host)
  if (!ref) return

  if (isIdeLabel(ref.label)) {
    return proxyRunIde(event, ref.sessionId)
  }
  await proxyRunPreview(event, ref.sessionId, ref.label)
})
