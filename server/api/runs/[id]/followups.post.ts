import { z } from 'zod'
import { db, schema } from '../../../db'
import { startFollowup } from '../../../daemon/followups'
import { requireSession } from '../../../utils/entities'
import { dispatchRuns } from '../../../daemon/dispatcher'
import { sessionHasActiveWork } from '../../../utils/sessions'

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
