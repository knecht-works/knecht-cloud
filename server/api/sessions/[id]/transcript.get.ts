import { requireSession } from '../../../utils/entities'
import { sessionTranscript } from '../../../utils/transcript'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  return sessionTranscript(session.id)
})
