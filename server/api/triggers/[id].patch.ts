import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import { getWorkflow } from '../../workflows'
import { isValidCron, nextRun } from '../../utils/cron'
import { toSummaries } from '../../utils/triggers'
import type { NewTrigger } from '../../db/schema'

// PATCH /api/triggers/:id → update a trigger. Used for the active toggle and for
// editing the workflow, projects or schedule. Toggling a schedule trigger on (or
// changing its cron) recomputes the next fire; pausing it clears the next fire.
const bodySchema = z.object({
  active: z.boolean().optional(),
  workflow: z.string().min(1).optional(),
  projectIds: z.array(z.number().int()).optional(),
  cron: z.string().min(1).optional(),
})

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid trigger id' })
  }

  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid trigger update' })
  }
  const data = result.data

  const row = db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger not found' })
  }

  const patch: Partial<NewTrigger> = { updatedAt: new Date() }
  if (data.workflow !== undefined) {
    if (!getWorkflow(data.workflow)) {
      throw createError({ statusCode: 404, statusMessage: 'Unknown workflow' })
    }
    patch.workflow = data.workflow
  }
  if (data.projectIds !== undefined) patch.projectIds = data.projectIds
  if (data.active !== undefined) patch.active = data.active
  if (data.cron !== undefined && row.source === 'schedule') {
    if (!isValidCron(data.cron)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cron expression' })
    }
    patch.cron = data.cron
  }

  // Keep the scheduler's next-fire in sync with active state + cron.
  if (row.source === 'schedule') {
    const active = patch.active ?? row.active
    const cron = patch.cron ?? row.cron
    patch.nextFireAt = active && cron ? nextRun(cron) : null
  }

  const updated = db.update(schema.triggers).set(patch).where(eq(schema.triggers.id, id)).returning().get()
  return toSummaries([updated])[0]
})
