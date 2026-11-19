import { listTriggers } from '../../stores/triggers'
import { toSummaries, type TriggerSummary } from '../../utils/triggers'
import { defineEventHandler } from 'h3'

export default defineEventHandler((): TriggerSummary[] => {
  return toSummaries(listTriggers())
})
