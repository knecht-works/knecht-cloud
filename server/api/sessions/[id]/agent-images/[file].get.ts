import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { requireSession } from '#server/stores/sessions'
import { requireIntParam } from '#server/utils/http'
import { readAgentImage } from '#server/utils/agent-images'

export default defineEventHandler(async (event) => {
  const session = requireSession(requireIntParam(event))
  const file = getRouterParam(event, 'file') ?? ''
  const image = await readAgentImage(session.id, file)
  if (!image) throw createError({ statusCode: 404, statusMessage: 'No such image.' })
  setResponseHeader(event, 'content-type', file.endsWith('.png') ? 'image/png' : 'image/jpeg')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'cache-control', 'private, max-age=3600')
  return image
})
