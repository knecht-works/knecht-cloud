import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { db, schema } from '../../db'
import { getWorkflow } from '../../workflows'
import { isValidCron, nextRun } from '../../utils/cron'
import { toSummaries } from '../../utils/triggers'

// POST /api/triggers → create a trigger. The body is a discriminated union on
// `source`: a schedule carries a cron expression; a github trigger gets a freshly
// generated webhook secret (returned once so it can be pasted into GitHub); a
// manual trigger just fires on demand. Each fires `workflow` against `projectIds`.
const projectIds = z.array(z.number().int()).default([])
const bodySchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('schedule'), workflow: z.string().min(1), projectIds, cron: z.string().min(1) }),
  z.object({ source: z.literal('github'), workflow: z.string().min(1), projectIds, webhookEvent: z.string().min(1).default('push') }),
  z.object({ source: z.literal('manual'), workflow: z.string().min(1), projectIds }),
])

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid trigger' })
  }
  const data = result.data

  if (!getWorkflow(data.workflow)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown workflow' })
  }

  const values = {
    source: data.source,
    workflow: data.workflow,
    projectIds: data.projectIds,
    cron: null as string | null,
    nextFireAt: null as Date | null,
    webhookSecret: null as string | null,
    webhookEvent: null as string | null,
  }

  if (data.source === 'schedule') {
    if (!isValidCron(data.cron)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cron expression' })
    }
    values.cron = data.cron
    values.nextFireAt = nextRun(data.cron)
  }
  if (data.source === 'github') {
    values.webhookSecret = randomBytes(24).toString('hex')
    values.webhookEvent = data.webhookEvent
  }

  const row = db.insert(schema.triggers).values(values).returning().get()

  // Return the summary plus the secret on github triggers — it's the only time
  // we hand it back, so the UI can show it for the GitHub webhook setup.
  return { ...toSummaries([row])[0], webhookSecret: row.webhookSecret }
})
