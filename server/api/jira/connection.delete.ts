import { deleteJiraConnection } from '../../utils/jira-credentials'

// DELETE /api/jira/connection → disconnect. Existing 'jira' triggers stay
// configured; the poller just skips them until Jira is connected again.
export default defineEventHandler(() => {
  deleteJiraConnection()
  return { configured: false, siteUrl: null, email: null, accountName: null, apiTokenPreview: null }
})
