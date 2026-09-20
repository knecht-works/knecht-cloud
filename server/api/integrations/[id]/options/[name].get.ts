import { z } from 'zod'
import { INTEGRATIONS } from '../../../../integrations'

export default defineEventHandler(async (event) => {
  const integration = INTEGRATIONS.find(i => i.id === getRouterParam(event, 'id'))
  const list = integration?.trigger.options?.[getRouterParam(event, 'name') ?? '']
  if (!integration || !list) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown option list' })
  }
  if (!integration.isConfigured()) {
    throw createError({ statusCode: 400, statusMessage: `${integration.name} is not connected` })
  }
  const project = z.string().min(1).safeParse(getQuery(event).project)
  if (!project.success) {
    throw createError({ statusCode: 400, statusMessage: 'Missing project' })
  }
  try {
    return await list(project.data)
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: `Could not reach ${integration.name}` })
  }
})
