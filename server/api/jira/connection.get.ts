import { jiraCredentials } from '../../utils/jira-credentials'
import { keyPreview } from '../../utils/settings'

export interface JiraConnectionStatus {
  configured: boolean
  siteUrl: string | null
  email: string | null
  accountName: string | null
  apiTokenPreview: string | null
}

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
