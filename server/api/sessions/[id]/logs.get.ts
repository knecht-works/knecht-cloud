import { listSessionRunSummaries, readRunLog } from '../../../stores/runs'
import { listRunSteps } from '../../../stores/run-steps'
import { requireSession } from '../../../stores/sessions'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  return listSessionRunSummaries(session.id)
    .filter(r => r.kind === 'workflow')
    .map(r => ({ runId: r.id, log: readRunLog(r.id, 0).text, steps: listRunSteps(r.id) }))
})
