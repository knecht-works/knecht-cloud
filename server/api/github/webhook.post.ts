import { github } from '../../integrations/github'
import { handleWebhook } from '../../utils/webhooks'
import { defineEventHandler } from 'h3'

export default defineEventHandler(event => handleWebhook(github, event))
