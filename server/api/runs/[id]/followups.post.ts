import { z } from 'zod'
import { db, schema } from '../../../db'
import { startFollowup } from '../../../daemon/followups'
import { requireSession } from '../../../utils/entities'
import { dispatchRuns } from '../../../daemon/dispatcher'
import { sessionHasActiveWork } from '../../../utils/sessions'

// POST /api/runs/:id/followups → send a follow-up prompt to the run's
// session: the agent continues the session's conversation inside the
// existing sandbox. Whether to publish is part of the prompt itself: the
// agent commits/pushes when asked and keeps an existing PR current;
// otherwise changes stay in the checkout for preview-first iteration.
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
  const session = requireSession(run.sessionId)

  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    zodBadRequest(result.error, 'Invalid follow-up')
  }

  if (run.status !== 'success' && run.status !== 'failed') {
    throw createError({ statusCode: 409, statusMessage: 'Only finished runs accept follow-ups' })
  }
  if (session.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'The session\'s environment is gone. Run the workflow again.' })
  }
  if (sessionHasActiveWork(session.id)) {
    throw createError({ statusCode: 409, statusMessage: 'The session is still executing work' })
  }

  const { user } = await requireUserSession(event)
  const followup = db.insert(schema.followups).values({
    sessionId: session.id,
    runId: id,
    prompt: result.data.prompt,
    requestedBy: user.login,
  }).returning().get()

  if (session.envState === 'up') void startFollowup(followup.id)
  else dispatchRuns()

  return followup
})
