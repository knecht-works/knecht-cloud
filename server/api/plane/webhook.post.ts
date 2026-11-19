import { plane } from '../../integrations/plane'
import { handleWebhook } from '../../utils/webhooks'
import { defineEventHandler } from 'h3'

export default defineEventHandler(event => handleWebhook(plane, event))
