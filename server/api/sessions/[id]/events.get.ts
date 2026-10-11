import { onLive } from '../../../utils/live'
import { sendEventStream } from '../../../utils/sse'
import { requireSession } from '../../../stores/sessions'

// One stream per open chat; every transcript write of the session lands here as it happens.
export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  return sendEventStream(event, push => onLive(session.id, (e) => {
    const data = e.type === 'item' ? e.item : e.type === 'followup-removed' ? { id: e.id } : e.followup
    push({ event: e.type, data: JSON.stringify(data) })
  }))
})
