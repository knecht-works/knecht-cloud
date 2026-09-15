import { INTEGRATIONS } from '../../../integrations'

export default defineEventHandler(async (event) => {
  const integration = INTEGRATIONS.find(i => i.id === getRouterParam(event, 'id'))
  if (!integration?.link) {
    throw createError({ statusCode: 404, statusMessage: 'This integration has no project links' })
  }
  if (!integration.isConfigured()) {
    throw createError({ statusCode: 400, statusMessage: `${integration.name} is not connected` })
  }
  try {
    return await integration.link.listTargets()
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: `Could not reach ${integration.name}` })
  }
})
