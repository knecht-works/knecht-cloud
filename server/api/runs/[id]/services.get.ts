import { sessionServices } from '../../../utils/session-services'
import { requireSession } from '../../../stores/sessions'

export default defineEventHandler(async (event) => {
  const run = requireRun(requireIntParam(event))
  const session = requireSession(run.sessionId)
  if (session.envState !== 'up') return []
  const url = getRequestURL(event)
  return (await sessionServices(session.id)).map(s => ({
    label: s.label,
    url: `${url.protocol}//${previewHostname(session.id, url.host, s.label)}`,
  }))
})
