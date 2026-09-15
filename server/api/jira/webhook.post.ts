import { jira } from '../../integrations/jira'
import { handleWebhook } from '../../utils/webhooks'

export default defineEventHandler(event => handleWebhook(jira, event))
