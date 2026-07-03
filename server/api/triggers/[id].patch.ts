import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import { getWorkflow } from '../../workflows'
import { isValidCron, nextRun } from '../../utils/cron'
import { toSummaries } from '../../utils/triggers'
import type { NewTrigger } from '../../db/schema'

// PATCH /api/triggers/:id → update a trigger. Covers the active toggle and full
// edits (source, projects, schedule, GitHub event). Changing the source rebuilds
// the source-specific fields: a schedule gets its cron + next-fire, a GitHub
// trigger a webhook secret (freshly minted when it becomes GitHub, returned once
// so the UI can show it), a manual trigger clears both.
const bodySchema = z.object({
  active: z.boolean().optional(),
  workflow: z.string().min(1).optional(),
  source: z.enum(['schedule', 'github', 'manual']).optional(),
  projectIds: z.array(z.number().int()).optional(),
  cron: z.string().min(1).optional(),
  webhookEvent: z.string().min(1).optional(),
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
  if (data.workflow !== undefined) {
    if (!getWorkflow(data.workflow)) {
      throw createError({ statusCode: 404, statusMessage: 'Unknown workflow' })
    }
    patch.workflow = data.workflow
  }
  if (data.projectIds !== undefined) patch.projectIds = data.projectIds
  if (data.active !== undefined) patch.active = data.active

  const nextSource = data.source ?? row.source
  if (data.source !== undefined) patch.source = data.source

  // Rebuild the source-specific fields for the (possibly new) source. Returned
  // to the client only when a fresh secret is minted (becoming a GitHub trigger).
  let newSecret: string | null = null
  if (nextSource === 'schedule') {
    const cron = data.cron ?? row.cron
    if (!cron || !isValidCron(cron)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid cron expression' })
    }
    patch.cron = cron
    patch.webhookSecret = null
    patch.webhookEvent = null
    const active = patch.active ?? row.active
    patch.nextFireAt = active ? nextRun(cron) : null
  }
  else if (nextSource === 'github') {
    patch.cron = null
    patch.nextFireAt = null
    patch.webhookEvent = data.webhookEvent ?? row.webhookEvent ?? 'push'
    // Mint a secret when the trigger becomes GitHub (or lacks one somehow);
    // keep the existing secret when it was already a GitHub trigger.
    if (row.source !== 'github' || !row.webhookSecret) {
      newSecret = randomBytes(24).toString('hex')
      patch.webhookSecret = newSecret
    }
  }
  else {
    patch.cron = null
    patch.nextFireAt = null
    patch.webhookSecret = null
    patch.webhookEvent = null
  }

  const updated = db.update(schema.triggers).set(patch).where(eq(schema.triggers.id, id)).returning().get()
  return { ...toSummaries([updated])[0], webhookSecret: newSecret }
})
