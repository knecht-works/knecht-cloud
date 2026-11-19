import { envTransition } from '../../daemon/envs'
import { listRunViews } from '../../stores/runs'
import { withSessionEnv, withSessionObjects } from '../../utils/run-view'
import { defineEventHandler, getQuery } from 'h3'

const LIST_LIMIT = 200

export default defineEventHandler((event) => {
  const projectId = Number(getQuery(event).projectId)

  return withSessionObjects(listRunViews(Number.isInteger(projectId) ? projectId : undefined, LIST_LIMIT))
    .map((r) => {
      const { steps, ...view } = withSessionEnv(r)
      return { ...view, envTransition: envTransition(r.sessionId) }
    })
})
