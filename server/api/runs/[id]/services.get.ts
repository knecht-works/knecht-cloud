import { sessionServices } from '#server/utils/session-services'
import { requireSession } from '#server/stores/sessions'
import { requireRun } from '#server/stores/runs'
import { defineEventHandler, getRequestURL } from 'h3'
import { requireIntParam } from '#server/utils/http'
import { previewHostname } from '#shared/utils/preview-host'

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
