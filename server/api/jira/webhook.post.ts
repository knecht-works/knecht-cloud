import { jira } from '#server/integrations/jira'
import { handleWebhook } from '#server/utils/webhooks'
import { defineEventHandler } from 'h3'

export default defineEventHandler(event => handleWebhook(jira, event))
