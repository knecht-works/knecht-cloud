import { cancelOperation } from '#server/daemon/session-env'
import { requireSession } from '#server/stores/sessions'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  return { cancelled: cancelOperation(session.id) }
})
