import type { H3Event } from 'h3'

export default defineEventHandler(async (event) => {
  const host = (event.node.req.headers.host ?? '').split(':')[0] ?? ''
  const ref = parsePreviewHost(host)
  if (!ref) return

  // Everything behind a preview host is project code or a tool: read the
  // session once (h3 keeps it on the event), then no proxy can forward it.
  // Restored afterwards: Nuxt renders an error page with these same headers.
  await getUserSession(event)
  removeResponseHeader(event, 'set-cookie')
  const { headers } = event.node.req
  const original = headers.cookie
  const cookie = withoutDashboardCookie(original)
  if (cookie) headers.cookie = cookie
  else delete headers.cookie
  try {
    await dispatch(event, ref)
  }
  finally {
    if (original === undefined) delete headers.cookie
    else headers.cookie = original
  }
})

async function dispatch(event: H3Event, ref: { sessionId: number, label?: string }): Promise<void> {
  if (isIdeLabel(ref.label)) return proxyRunIde(event, ref.sessionId)
  const service = ref.label ? await findSessionService(ref.sessionId, ref.label) : undefined
  if (service) return proxyRunService(event, ref.sessionId, service)
  await proxyRunPreview(event, ref.sessionId, ref.label)
}
