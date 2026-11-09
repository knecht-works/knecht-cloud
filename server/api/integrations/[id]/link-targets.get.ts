import { INTEGRATIONS } from '../../../integrations'
import type { LinkTarget } from '../../../integrations/types'
import { refreshLinkNames } from '../../../stores/project-links'

export default defineEventHandler(async (event) => {
  const integration = INTEGRATIONS.find(i => i.id === getRouterParam(event, 'id'))
  if (!integration?.link) {
    throw createError({ statusCode: 404, statusMessage: 'This integration has no project links' })
  }
  if (!integration.isConfigured()) {
    throw createError({ statusCode: 400, statusMessage: `${integration.name} is not connected` })
  }
  let targets: LinkTarget[]
  try {
    targets = await integration.link.listTargets()
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: `Could not reach ${integration.name}` })
  }
  refreshLinkNames(integration.id, targets)
  return targets
})
