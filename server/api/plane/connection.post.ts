import { z } from 'zod'
import { forgetPlaneCache, planeMyself } from '../../integrations/plane/api'
import { planeConnectionStatus, planeCredentials, savePlaneCredentials } from '../../integrations/plane/credentials'

const bodySchema = z.object({
  siteUrl: z.string().trim().min(1)
    .transform(u => u.replace(/\/+$/, ''))
    .pipe(z.string().url().startsWith('https://', 'The site URL must start with https://')),
  workspaceSlug: z.string().trim().min(1).regex(/^[a-z0-9-]+$/i, 'The workspace slug is the first path segment of your Plane URL'),
  apiKey: z.string().trim(),
  webhookSecret: z.string().trim().optional(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid connection' })
  }
  const { siteUrl, workspaceSlug, webhookSecret } = result.data
  // The key stays when the admin only comes back to paste the webhook secret.
  const apiKey = result.data.apiKey || planeCredentials()?.apiKey
  if (!apiKey) {
    throw createError({ statusCode: 400, statusMessage: 'Paste an API key' })
  }

  let me: { displayName: string, accountId: string }
  try {
    me = await planeMyself({ siteUrl, workspaceSlug, apiKey })
  }
  catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Plane rejected the connection. Check the site URL, workspace slug and API key.',
    })
  }

  savePlaneCredentials({ siteUrl, workspaceSlug, apiKey, webhookSecret, accountName: me.displayName, accountId: me.accountId })
  forgetPlaneCache()
  return planeConnectionStatus()
})
