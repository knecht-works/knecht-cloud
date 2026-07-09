import { listJiraProjects } from '../../utils/jira'
import { isJiraConfigured } from '../../utils/jira-credentials'

// GET /api/jira/projects → the Jira projects the connected account can browse
// (the trigger form's project dropdown).
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
