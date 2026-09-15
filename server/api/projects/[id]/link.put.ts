import { z } from 'zod'
import { INTEGRATION_IDS } from '../../../../shared/utils/integrations'
import { getIntegration } from '../../../integrations'
import { linkedProject, projectLinks, setProjectLink } from '../../../utils/project-links'

const bodySchema = z.object({
  integration: z.enum(INTEGRATION_IDS),
  key: z.string().trim().min(1).nullable(),
})

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  requireProject(id)

  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid project link' })
  }
  const { integration, key } = result.data
  const link = getIntegration(integration).link
  if (!link) {
    throw createError({ statusCode: 400, statusMessage: `${integration} has no project links` })
  }
  if (key) {
    const taken = linkedProject(integration, key)
    if (taken && taken.id !== id) {
      throw createError({ statusCode: 400, statusMessage: `${link.label} ${key} is already linked to ${taken.fullName}` })
    }
  }
  setProjectLink(id, integration, key)
  return projectLinks(id)
})
