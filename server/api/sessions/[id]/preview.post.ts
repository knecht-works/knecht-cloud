import { requireProject } from '../../../stores/projects'
import { requireSession } from '../../../stores/sessions'
import { queueSessionRun } from '../../../utils/session-runs'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  if (session.tier === 'preview') {
    throw createError({ statusCode: 409, statusMessage: 'This session already has a preview' })
  }
  return queueSessionRun(requireProject(session.projectId), session, true)
})
