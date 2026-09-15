import { z } from 'zod'
import { jiraMyself } from '../../integrations/jira/api'
import { jiraConnectionStatus, saveJiraCredentials } from '../../integrations/jira/credentials'

const bodySchema = z.object({
  siteUrl: z.string().trim().min(1)
    .transform(u => u.replace(/\/+$/, ''))
    .pipe(z.string().url().startsWith('https://', 'The site URL must start with https://')),
  email: z.string().trim().email(),
  apiToken: z.string().trim().min(1),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid connection' })
  }
  const { siteUrl, email, apiToken } = result.data

  let me: { displayName: string, accountId: string }
  try {
    me = await jiraMyself({ siteUrl, email, apiToken })
  }
  catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Jira rejected the connection. Check the site URL, email and API token.',
    })
  }

  saveJiraCredentials({ siteUrl, email, apiToken, accountName: me.displayName, accountId: me.accountId })
  return jiraConnectionStatus()
})
