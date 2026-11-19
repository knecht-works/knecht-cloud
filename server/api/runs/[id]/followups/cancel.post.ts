import { cancelFollowupWork } from '#server/daemon/followups'
import { requireRun } from '#server/stores/runs'
import { defineEventHandler, createError } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)

  const cancelled = cancelFollowupWork(run.sessionId)
  if (!cancelled) {
    throw createError({ statusCode: 409, statusMessage: 'No follow-up is running' })
  }
  return { cancelled: true }
})
