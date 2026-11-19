import { deleteTrigger, requireTrigger } from '#server/stores/triggers'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  requireTrigger(id)

  deleteTrigger(id)
  return { ok: true }
})
