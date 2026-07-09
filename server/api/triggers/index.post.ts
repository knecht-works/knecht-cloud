import { z } from 'zod'
import { db, schema } from '../../db'
import type { IssueAction } from '../../db/schema'
import { getWorkflow } from '../../workflows'
import { isValidCron, nextRun } from '../../utils/cron'
import { toSummaries } from '../../utils/triggers'
import { TRIGGER_SOURCES } from '../../utils/trigger-sources'

// POST /api/triggers → create a trigger. The body is a discriminated union on
// `source`: a schedule carries a cron expression; a github trigger listens for
// deliveries on the app webhook (/api/github/webhook, configured automatically
// at setup); a manual trigger just fires on demand; registry sources (jira, …)
// carry their settings in `config`, validated by the source's own schema. Each
// fires `workflow` against `projectIds`.
const projectIds = z.array(z.number().int()).default([])
const bodySchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('schedule'), workflow: z.string().min(1), projectIds, cron: z.string().min(1) }),
  z.object({
    source: z.literal('github'),
    workflow: z.string().min(1),
    projectIds,
    webhookEvent: z.enum(['push', 'pull_request', 'issues']).default('push'),
    // push: the pushed branch; pull_request: the base branch. Empty = all.
    webhookBranches: z.array(z.string().min(1)).default([]),
    issueActions: z.array(z.enum(['opened', 'labeled'])).min(1).default(['opened']),
    issueLabel: z.string().min(1).nullish(),
  }),
  z.object({ source: z.literal('manual'), workflow: z.string().min(1), projectIds }),
  ...TRIGGER_SOURCES.map(def =>
    z.object({ source: z.literal(def.source), workflow: z.string().min(1), projectIds, config: def.configSchema }),
  ),
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
    webhookEvent: null as string | null,
    webhookBranches: [] as string[],
    issueActions: ['opened'] as IssueAction[],
    issueLabel: null as string | null,
    config: {} as Record<string, unknown>,
    state: {} as Record<string, unknown>,
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
  if ('config' in data) {
    const def = TRIGGER_SOURCES.find(d => d.source === data.source)!
    values.config = data.config
    // Seed the state (e.g. jira's already-matching keys) so the trigger reacts
    // to changes from now on. A failure here is a connection problem the user
    // should see at create time, not a broken trigger later.
    try {
      values.state = await def.init(data.config)
    }
    catch {
      throw createError({ statusCode: 400, statusMessage: `Could not reach ${data.source} to set up the trigger` })
    }
  }

  const row = db.insert(schema.triggers).values(values).returning().get()

  return toSummaries([row])[0]
})
