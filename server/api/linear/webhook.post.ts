import { linear } from '../../integrations/linear'
import { handleWebhook } from '../../utils/webhooks'

export default defineEventHandler(event => handleWebhook(linear, event))
