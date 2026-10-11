import { deleteTrigger, requireTrigger } from '../../stores/triggers'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  requireTrigger(id)

  deleteTrigger(id)
  return { ok: true }
})
