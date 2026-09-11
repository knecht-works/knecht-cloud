import { deleteJiraConnection } from '../../utils/jira-credentials'

export default defineEventHandler(() => {
  deleteJiraConnection()
  return { configured: false, siteUrl: null, email: null, accountName: null, apiTokenPreview: null }
})
