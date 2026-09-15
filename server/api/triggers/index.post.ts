import { z } from 'zod'
import { db, schema } from '../../db'
import type { IssueAction } from '../../db/schema'
import { isValidCron, nextRun } from '../../utils/cron'
import { toSummaries } from '../../utils/triggers'

const projectIds = z.array(z.number().int()).default([])
const workflowId = z.number().int()
const bodySchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('schedule'), workflowId, projectIds, cron: z.string().min(1) }),
  z.object({
    source: z.literal('github'),
    workflowId,
    projectIds,
    webhookEvent: z.enum(['push', 'pull_request', 'issues']).default('push'),
    webhookBranches: z.array(z.string().min(1)).default([]),
    issueActions: z.array(z.enum(['opened', 'labeled'])).min(1).default(['opened']),
    issueLabel: z.string().min(1).nullish(),
  }),
  z.object({ source: z.literal('manual'), workflowId, projectIds }),
])

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid trigger' })
  }
  const data = result.data

  requireWorkflowRow(data.workflowId)

  const values = {
    source: data.source,
    workflowId: data.workflowId,
    projectIds: data.projectIds,
    cron: null as string | null,
    nextFireAt: null as Date | null,
    webhookEvent: null as string | null,
    webhookBranches: [] as string[],
    issueActions: ['opened'] as IssueAction[],
    issueLabel: null as string | null,
    config: {} as Record<string, unknown>,
  }

  if (data.source === 'schedule') {
    if (!isValidCron(data.cron)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cron expression' })
    }
    values.cron = data.cron
    values.nextFireAt = nextRun(data.cron)
  }
  if (data.source === 'github') {
    if (data.webhookEvent === 'issues' && data.issueActions.includes('labeled') && !data.issueLabel) {
      throw createError({ statusCode: 400, statusMessage: 'A label is required to trigger on "labeled"' })
    }
    values.webhookEvent = data.webhookEvent
    values.webhookBranches = data.webhookBranches
    values.issueActions = data.issueActions
    values.issueLabel = data.issueLabel ?? null
  }
  const row = db.insert(schema.triggers).values(values).returning().get()

  return toSummaries([row])[0]
})
