import { jira } from '../../integrations/jira'
import { handleWebhook } from '../../utils/webhooks'
import { defineEventHandler } from 'h3'

export default defineEventHandler(event => handleWebhook(jira, event))
