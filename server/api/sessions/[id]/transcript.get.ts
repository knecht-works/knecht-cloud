import { sessionTranscript } from '../../../utils/transcript'
import { requireSession } from '../../../stores/sessions'

export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  return sessionTranscript(session.id)
})
