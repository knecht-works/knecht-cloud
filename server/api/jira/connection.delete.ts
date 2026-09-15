import { deleteJiraConnection, jiraConnectionStatus } from '../../integrations/jira/credentials'

export default defineEventHandler(() => {
  deleteJiraConnection()
  return jiraConnectionStatus()
})
