import { linear } from '../../integrations/linear'
import { handleWebhook } from '../../utils/webhooks'
import { defineEventHandler } from 'h3'

export default defineEventHandler(event => handleWebhook(linear, event))
