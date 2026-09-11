import { z } from 'zod'
import { jiraMyself } from '../../utils/jira'
import { jiraCredentials, saveJiraCredentials } from '../../utils/jira-credentials'
import { keyPreview } from '../../utils/settings'

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

  let accountName: string
  try {
    accountName = (await jiraMyself({ siteUrl, email, apiToken })).displayName
  }
  catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Jira rejected the connection. Check the site URL, email and API token.',
    })
  }

  saveJiraCredentials({ siteUrl, email, apiToken, accountName })
  const creds = jiraCredentials()
  return {
    configured: true,
    siteUrl: creds?.siteUrl ?? siteUrl,
    email: creds?.email ?? email,
    accountName: creds?.accountName ?? accountName,
    apiTokenPreview: keyPreview(apiToken),
  }
})
