import { envTransition, previewLost } from '../../daemon/envs'
import { getRunView, latestSessionPrUrl } from '../../stores/runs'
import { getProject } from '../../stores/projects'
import { gitProvider } from '../../git'
import { withSessionEnv, withSessionObjects } from '../../utils/run-view'
import { defineEventHandler, createError } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)

  const run = getRunView(id)

  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }

  const project = getProject(run.projectId)
  const branchUrl = project && run.branch ? gitProvider(project).branchUrl(project, run.branch) : null
  const [withObjects] = withSessionObjects([run])
  return { ...withSessionEnv(withObjects!), branchUrl, envTransition: envTransition(run.sessionId), previewLost: previewLost(run.sessionId), sessionPrUrl: latestSessionPrUrl(run.sessionId) }
})
