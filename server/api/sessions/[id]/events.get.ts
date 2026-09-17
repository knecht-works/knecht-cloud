import { requireSession } from '../../../utils/entities'
import { onLive } from '../../../utils/live'

const HEARTBEAT_MS = 25_000

// One stream per open chat; every transcript write of the session lands here as it happens.
export default defineEventHandler((event) => {
  const session = requireSession(requireIntParam(event))
  const stream = createEventStream(event)

  const off = onLive(session.id, (e) => {
    const data = e.type === 'item' ? e.item : e.type === 'followup-removed' ? { id: e.id } : e.followup
    void stream.push({ event: e.type, data: JSON.stringify(data) })
  })
  const heartbeat = setInterval(() => void stream.push({ event: 'ping', data: '' }), HEARTBEAT_MS)
  stream.onClosed(async () => {
    off()
    clearInterval(heartbeat)
    await stream.close()
  })
  // Headers only go out with the first chunk; the browser's "open" waits for them.
  void stream.push({ event: 'ready', data: '' })
  return stream.send()
})
