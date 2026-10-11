import { listTriggers } from '../../stores/triggers'
import { toSummaries, type TriggerSummary } from '../../utils/triggers'

export default defineEventHandler((): TriggerSummary[] => {
  return toSummaries(listTriggers())
})
