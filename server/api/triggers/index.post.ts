import { z } from 'zod'
import { TRIGGER_SOURCES } from '../../../shared/utils/integrations'
import { db, schema } from '../../db'
import { isValidCron, nextRun } from '../../utils/cron'
import { toSummaries } from '../../utils/triggers'
import { getTriggerSource } from '../../utils/trigger-sources'

const bodySchema = z.object({
  source: z.enum(TRIGGER_SOURCES),
  workflowId: z.number().int(),
  projectIds: z.array(z.number().int()).default([]),
  cron: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: result.error.issues[0]?.message ?? 'Invalid trigger' })
  }
  const data = result.data

  requireWorkflowRow(data.workflowId)

  const def = getTriggerSource(data.source)
  if (!def) {
    throw createError({ statusCode: 400, statusMessage: `${data.source} triggers are not available` })
  }
  const config = def.configSchema.safeParse(data.config)
  if (!config.success) {
    throw createError({ statusCode: 400, statusMessage: config.error.issues[0]?.message ?? 'Invalid trigger config' })
  }
  const projectError = def.validateProjects?.(data.projectIds)
  if (projectError) {
    throw createError({ statusCode: 400, statusMessage: projectError })
  }

  const values = {
    source: data.source,
    workflowId: data.workflowId,
    projectIds: data.projectIds,
    cron: null as string | null,
    nextFireAt: null as Date | null,
    config: config.data,
  }

  if (data.source === 'schedule') {
    if (!data.cron || !isValidCron(data.cron)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cron expression' })
    }
    values.cron = data.cron
    values.nextFireAt = nextRun(data.cron)
  }

  const row = db.insert(schema.triggers).values(values).returning().get()

  return toSummaries([row])[0]
})
