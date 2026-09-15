import { jiraConnectionStatus } from '../../integrations/jira/credentials'

export default defineEventHandler(() => jiraConnectionStatus())
