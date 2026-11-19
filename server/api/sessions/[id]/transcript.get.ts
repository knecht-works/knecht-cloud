import { sessionTranscript } from '#server/utils/transcript'
import { requireSession } from '#server/stores/sessions'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  return sessionTranscript(session.id)
})
