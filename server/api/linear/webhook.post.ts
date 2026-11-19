import { linear } from '#server/integrations/linear'
import { handleWebhook } from '#server/utils/webhooks'
import { defineEventHandler } from 'h3'

export default defineEventHandler(event => handleWebhook(linear, event))
