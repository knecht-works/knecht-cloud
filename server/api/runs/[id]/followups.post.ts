import { z } from 'zod'
import { db, schema } from '../../../db'
import { hasActiveFollowup, startFollowup } from '../../../daemon/followups'
import { dispatchRuns } from '../../../daemon/dispatcher'

// POST /api/runs/:id/followups → send a follow-up prompt to a finished run:
// the agent continues the run's opencode session inside the run's existing
// sandbox (docs/plans/run-follow-ups.md). `push` asks the agent to publish
// its changes (with a deterministic host-side fallback); off, the changes
// stay in the worktree for preview-first iteration.
//
// Fast lane vs queue: an 'up' env costs no new RAM, so its follow-up starts
// immediately; a stopped/archived env must be revived, which takes a
// dispatcher slot like a run does.
const bodySchema = z.object({
  prompt: z.string().trim().min(1),
  push: z.boolean().default(true),
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
    push: result.data.push,
    requestedBy: user.login,
  }).returning().get()

  if (run.envState === 'up') void startFollowup(followup.id)
  else dispatchRuns()

  return followup
})
