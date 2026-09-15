import { listJiraProjects } from '../../integrations/jira/api'
import { isJiraConfigured } from '../../integrations/jira/credentials'

export default defineEventHandler(async () => {
  if (!isJiraConfigured()) {
    throw createError({ statusCode: 400, statusMessage: 'Jira is not connected' })
  }
  try {
    return await listJiraProjects()
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach Jira' })
  }
})
