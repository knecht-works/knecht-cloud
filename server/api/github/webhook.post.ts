import { github } from '#server/integrations/github'
import { handleWebhook } from '#server/utils/webhooks'
import { defineEventHandler } from 'h3'

export default defineEventHandler(event => handleWebhook(github, event))
