import { github } from '../../integrations/github'
import { handleWebhook } from '../../utils/webhooks'

export default defineEventHandler(event => handleWebhook(github, event))
