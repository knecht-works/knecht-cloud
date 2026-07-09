import { z } from 'zod'
import { listJiraStatuses } from '../../utils/jira'
import { isJiraConfigured } from '../../utils/jira-credentials'

// GET /api/jira/statuses?project=KEY → the distinct status names of one Jira
// project (the trigger form's status dropdown).
export default defineEventHandler(async (event) => {
  if (!isJiraConfigured()) {
    throw createError({ statusCode: 400, statusMessage: 'Jira is not connected' })
  }
  const project = z.string().min(1).safeParse(getQuery(event).project)
  if (!project.success) {
    throw createError({ statusCode: 400, statusMessage: 'Missing project key' })
  }
  try {
    return await listJiraStatuses(project.data)
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach Jira' })
  }
})
