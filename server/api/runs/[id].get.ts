import { envTransition, previewLost } from '#server/daemon/envs'
import { getRunView, latestSessionPrUrl } from '#server/stores/runs'
import { getProject } from '#server/stores/projects'
import { gitProvider } from '#server/git'
import { withSessionEnv, withSessionObjects } from '#server/utils/run-view'
import { sessionHasActiveWork } from '#server/utils/sessions'
import { bootUnfinished, envActions } from '#shared/utils/run'
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
  const view = withSessionEnv(withObjects!)
  const operation = envTransition(run.sessionId)
  const lost = previewLost(run.sessionId)
  const env = { envState: view.envState, operation, working: sessionHasActiveWork(run.sessionId), hasEnv: view.hasEnv, previewReady: view.previewReady, previewLost: lost }
  return { ...view, branchUrl, envTransition: operation, previewLost: lost, envActions: envActions(env), bootUnfinished: bootUnfinished(env), sessionPrUrl: latestSessionPrUrl(run.sessionId) }
})
