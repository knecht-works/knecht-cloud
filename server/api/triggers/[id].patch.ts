import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import { isValidCron, nextRun } from '../../utils/cron'
import { toSummaries } from '../../utils/triggers'
import { getTriggerSource } from '../../utils/trigger-sources'
import type { NewTrigger } from '../../db/schema'

const bodySchema = z.object({
  active: z.boolean().optional(),
  workflowId: z.number().int().optional(),
  source: z.enum(['schedule', 'github', 'manual', 'jira']).optional(),
  projectIds: z.array(z.number().int()).optional(),
  cron: z.string().min(1).optional(),
  webhookEvent: z.enum(['push', 'pull_request', 'issues']).optional(),
  webhookBranches: z.array(z.string().min(1)).optional(),
  issueActions: z.array(z.enum(['opened', 'labeled'])).min(1).optional(),
  issueLabel: z.string().min(1).nullish(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)

  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid trigger update' })
  }
  const data = result.data

  const row = requireTrigger(id)

  const patch: Partial<NewTrigger> = { updatedAt: new Date() }
  if (data.workflowId !== undefined) {
    requireWorkflowRow(data.workflowId)
    patch.workflowId = data.workflowId
  }
  if (data.projectIds !== undefined) patch.projectIds = data.projectIds
  if (data.active !== undefined) patch.active = data.active

  const nextSource = data.source ?? row.source
  if (data.source !== undefined) patch.source = data.source

  if (nextSource === 'schedule') {
    const cron = data.cron ?? row.cron
    if (!cron || !isValidCron(cron)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cron expression' })
    }
    patch.cron = cron
    patch.webhookEvent = null
    const active = patch.active ?? row.active
    patch.nextFireAt = active ? nextRun(cron) : null
  }
  else if (nextSource === 'github') {
    patch.cron = null
    patch.nextFireAt = null
    const webhookEvent = data.webhookEvent ?? row.webhookEvent ?? 'push'
    const issueActions = data.issueActions ?? row.issueActions
    const issueLabel = data.issueLabel !== undefined ? data.issueLabel : row.issueLabel
    if (webhookEvent === 'issues' && issueActions.includes('labeled') && !issueLabel) {
      throw createError({ statusCode: 400, statusMessage: 'A label is required to trigger on "labeled"' })
    }
    patch.webhookEvent = webhookEvent
    patch.webhookBranches = data.webhookBranches ?? row.webhookBranches
    patch.issueActions = issueActions
    patch.issueLabel = issueLabel
  }
  else {
    patch.cron = null
    patch.nextFireAt = null
    patch.webhookEvent = null
    patch.webhookBranches = []
    patch.issueActions = ['opened']
    patch.issueLabel = null
  }

  // Re-seed the state so the edited condition does not fire on its backlog.
  const def = getTriggerSource(nextSource)
  if (def) {
    const parsed = def.configSchema.safeParse(data.config ?? row.config)
    if (!parsed.success) {
      throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Invalid trigger config' })
    }
    patch.config = parsed.data
    if (JSON.stringify(parsed.data) !== JSON.stringify(row.config)) {
      try {
        patch.state = await def.init(parsed.data)
      }
      catch {
        throw createError({ statusCode: 400, statusMessage: `Could not reach ${nextSource} to set up the trigger` })
      }
    }
  }
  else if (nextSource !== row.source) {
    patch.config = {}
    patch.state = {}
  }

  const updated = db.update(schema.triggers).set(patch).where(eq(schema.triggers.id, id)).returning().get()
  return toSummaries([updated])[0]
})
