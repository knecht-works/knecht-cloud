import { z } from 'zod'
import { isPlaneConfigured, planeConnectionStatus, savePlaneWebhookSecret } from '../../integrations/plane/credentials'

const bodySchema = z.object({ webhookSecret: z.string().trim().min(1, 'Paste the secret key of the webhook') })

export default defineEventHandler(async (event) => {
  if (!isPlaneConfigured()) {
    throw createError({ statusCode: 400, statusMessage: 'Plane is not connected' })
  }
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid secret' })
  }
  savePlaneWebhookSecret(result.data.webhookSecret)
  return planeConnectionStatus()
})
