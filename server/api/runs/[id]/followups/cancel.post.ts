import { cancelFollowupWork } from '../../../../daemon/followups'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)

  const cancelled = cancelFollowupWork(run.sessionId)
  if (!cancelled) {
    throw createError({ statusCode: 409, statusMessage: 'No follow-up is running' })
  }
  return { cancelled: true }
})
