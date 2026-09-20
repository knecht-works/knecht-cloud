import { z } from 'zod'
import { connectionOf } from '../../../utils/integration-routes'

const bodySchema = z.object({ webhookSecret: z.string().trim().min(1, 'Paste the secret key of the webhook') })

export default defineEventHandler(async (event) => {
  const { integration, connection } = connectionOf(event)
  if (connection.form.webhook.secret !== 'pasted') {
    throw createError({ statusCode: 404, statusMessage: `${integration.name} uses the secret Knecht generates` })
  }
  if (!connection.store.status().configured) {
    throw createError({ statusCode: 400, statusMessage: `${integration.name} is not connected` })
  }
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid secret' })
  }
  connection.store.saveWebhookSecret(result.data.webhookSecret)
  return connection.store.status()
})
