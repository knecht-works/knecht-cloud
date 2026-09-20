import { plane } from '../../integrations/plane'
import { handleWebhook } from '../../utils/webhooks'

export default defineEventHandler(event => handleWebhook(plane, event))
