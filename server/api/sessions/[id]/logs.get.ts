import { listSessionRunSummaries, readRunLog } from '#server/stores/runs'
import { listRunSteps } from '#server/stores/run-steps'
import { requireSession } from '#server/stores/sessions'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  return listSessionRunSummaries(session.id)
    .filter(r => r.kind === 'workflow')
    .map(r => ({ runId: r.id, log: readRunLog(r.id, 0).text, steps: listRunSteps(r.id) }))
})
