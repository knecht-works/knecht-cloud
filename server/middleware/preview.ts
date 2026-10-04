export default defineEventHandler(async (event) => {
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  const ref = parsePreviewHost(host)
  if (!ref) return

  if (isIdeLabel(ref.label)) {
    return proxyRunIde(event, ref.sessionId)
  }
  const service = ref.label ? await findSessionService(ref.sessionId, ref.label) : undefined
  if (service) return proxyRunService(event, ref.sessionId, service)
  await proxyRunPreview(event, ref.sessionId, ref.label)
})
