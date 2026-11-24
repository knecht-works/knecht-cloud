import { z } from 'zod'
import { TRACKER_IDS, TRIGGER_SOURCES } from '#shared/utils/integrations'
import { isValidCron, nextRun } from '#server/utils/cron'
import { toSummaries, triggerTakesBranch } from '#server/utils/triggers'
import { getTriggerSource } from '#server/utils/trigger-sources'
import { requireWorkflowRow } from '#server/stores/workflows'
import { createTrigger } from '#server/stores/triggers'
import { defineEventHandler, readBody, createError } from 'h3'

const bodySchema = z.object({
  source: z.enum(TRIGGER_SOURCES),
  integration: z.enum(TRACKER_IDS).optional(),
  workflowId: z.number().int(),
  projectIds: z.array(z.number().int()).default([]),
  cron: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  branch: z.string().trim().min(1).nullable().default(null),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid trigger' })
  }
  const data = result.data

  requireWorkflowRow(data.workflowId)

  if ((data.source === 'tracker') !== !!data.integration) {
    throw createError({ statusCode: 400, statusMessage: data.integration ? `${data.source} triggers take no integration` : 'Pick the issue tracker' })
  }
  const def = getTriggerSource(data.source, data.integration)
  if (!def) {
    throw createError({ statusCode: 400, statusMessage: `${data.integration ?? data.source} triggers are not available` })
  }
  const config = def.configSchema.safeParse(data.config)
  if (!config.success) {
    throw createError({ statusCode: 400, statusMessage: config.error.issues[0]?.message ?? 'Invalid trigger config' })
  }
  if (data.branch && !triggerTakesBranch(data.source, config.data)) {
    throw createError({ statusCode: 400, statusMessage: 'A pull request trigger works on the pull request branch' })
  }
  const projectError = def.validateProjects?.(data.projectIds)
  if (projectError) {
    throw createError({ statusCode: 400, statusMessage: projectError })
  }

  const values = {
    source: data.source,
    integration: data.integration ?? null,
    workflowId: data.workflowId,
    projectIds: data.projectIds,
    cron: null as string | null,
    nextFireAt: null as Date | null,
    config: config.data,
    branch: data.branch,
  }

  if (data.source === 'schedule') {
    if (!data.cron || !isValidCron(data.cron)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cron expression' })
    }
    values.cron = data.cron
    values.nextFireAt = nextRun(data.cron)
  }

  const row = createTrigger(values)

  return toSummaries([row])[0]
})
