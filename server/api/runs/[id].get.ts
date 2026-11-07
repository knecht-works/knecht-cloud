import { envTransition, previewLost } from '../../daemon/envs'
import { getRunView } from '../../stores/runs'
import { getProject } from '../../stores/projects'
import { gitProvider } from '../../git'
import { withSessionEnv } from '../../utils/run-view'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)

  const run = getRunView(id)

  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }

  const project = getProject(run.projectId)
  const branchUrl = project && run.branch ? gitProvider(project).branchUrl(project, run.branch) : null
  return { ...withSessionEnv(run), branchUrl, envTransition: envTransition(run.sessionId), previewLost: previewLost(run.sessionId) }
})
