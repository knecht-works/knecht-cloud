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
  const def = getTriggerSource(nextSource)
  if (!def) {
    throw createError({ statusCode: 400, statusMessage: `${nextSource} triggers are not available` })
  }

  // A switched source starts from an empty config: the old one belongs to another schema.
  const config = def.configSchema.safeParse(data.config ?? (nextSource === row.source ? row.config : {}))
  if (!config.success) {
    throw createError({ statusCode: 400, statusMessage: config.error.issues[0]?.message ?? 'Invalid trigger config' })
  }
  patch.config = config.data

  const projectError = def.validateProjects?.(patch.projectIds ?? row.projectIds)
  if (projectError) {
    throw createError({ statusCode: 400, statusMessage: projectError })
  }

  if (nextSource === 'schedule') {
    const cron = data.cron ?? row.cron
    if (!cron || !isValidCron(cron)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cron expression' })
    }
    patch.cron = cron
    const active = patch.active ?? row.active
    patch.nextFireAt = active ? nextRun(cron) : null
  }
  else {
    patch.cron = null
    patch.nextFireAt = null
  }

  const updated = db.update(schema.triggers).set(patch).where(eq(schema.triggers.id, id)).returning().get()
  return toSummaries([updated])[0]
})
