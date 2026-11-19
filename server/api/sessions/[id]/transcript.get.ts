import { sessionTranscript } from '../../../utils/transcript'
import { requireSession } from '../../../stores/sessions'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  return sessionTranscript(session.id)
})
