import { jiraCredentials } from '../../utils/jira-credentials'
import { keyPreview } from '../../utils/settings'

export interface JiraConnectionStatus {
  configured: boolean
  siteUrl: string | null
  email: string | null
  accountName: string | null
  apiTokenPreview: string | null
}

// GET /api/jira/connection → what the Settings panel shows. The API token is
// write-only: only a masked recognition preview leaves the server.
export default defineEventHandler((): JiraConnectionStatus => {
  const creds = jiraCredentials()
  return {
    configured: !!creds,
    siteUrl: creds?.siteUrl ?? null,
    email: creds?.email ?? null,
    accountName: creds?.accountName ?? null,
    apiTokenPreview: creds ? keyPreview(creds.apiToken) : null,
  }
})
