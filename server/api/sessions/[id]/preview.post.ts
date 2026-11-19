import { requireProject } from '#server/stores/projects'
import { requireSession } from '#server/stores/sessions'
import { queueSessionRun } from '#server/utils/session-runs'
import { defineEventHandler, createError } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  if (session.tier === 'preview') {
    throw createError({ statusCode: 409, statusMessage: 'This session already has a preview' })
  }
  return queueSessionRun(requireProject(session.projectId), session, true)
})
