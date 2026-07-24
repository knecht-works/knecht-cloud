import { z } from 'zod'
import { db, schema } from '../../../db'
import { hasActiveFollowup, startFollowup } from '../../../daemon/followups'
import { dispatchRuns } from '../../../daemon/dispatcher'

// POST /api/runs/:id/followups → send a follow-up prompt to a finished run:
// the agent continues the run's opencode session inside the run's existing
// sandbox (docs/plans/run-follow-ups.md). Whether to publish is part of the
// prompt itself: the agent commits/pushes when asked and keeps an existing PR
// current; otherwise changes stay in the checkout for preview-first iteration.
//
// Fast lane vs queue: an 'up' env costs no new RAM, so its follow-up starts
// immediately; a stopped/archived env must be revived, which takes a
// dispatcher slot like a run does.
const bodySchema = z.object({
  prompt: z.string().trim().min(1),
})

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)

  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    zodBadRequest(result.error, 'Invalid follow-up')
  }

  if (run.status !== 'success' && run.status !== 'failed') {
    throw createError({ statusCode: 409, statusMessage: 'Only finished runs accept follow-ups' })
  }
  if (run.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'The run\'s environment is gone. Run the workflow again.' })
  }
  if (hasActiveFollowup(id)) {
    throw createError({ statusCode: 409, statusMessage: 'A follow-up is already running on this run' })
  }

  const { user } = await requireUserSession(event)
  const followup = db.insert(schema.followups).values({
    runId: id,
    prompt: result.data.prompt,
    requestedBy: user.login,
  }).returning().get()

  if (run.envState === 'up') void startFollowup(followup.id)
  else dispatchRuns()

  return followup
})
