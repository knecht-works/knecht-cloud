import { requireSession } from '#server/stores/sessions'
import { requireProject } from '#server/stores/projects'
import { hasPreviewTarget } from '#server/utils/preview-target'
import { shareSession } from '#server/utils/preview-share'
import { defineEventHandler, createError } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  const project = requireProject(session.projectId)
  if (session.envState === 'down' || !hasPreviewTarget(session, project)) {
    throw createError({ statusCode: 409, statusMessage: 'This session has no preview to share' })
  }
  return shareSession(session.id, project)
})
