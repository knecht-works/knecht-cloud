import { requireSession } from '../../../stores/sessions'
import { requireProject } from '../../../stores/projects'
import { hasPreviewTarget } from '../../../utils/preview-target'
import { shareSession } from '../../../utils/preview-share'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  const project = requireProject(session.projectId)
  if (session.envState === 'down' || !hasPreviewTarget(session, project)) {
    throw createError({ statusCode: 409, statusMessage: 'This session has no preview to share' })
  }
  return shareSession(session.id, project)
})
