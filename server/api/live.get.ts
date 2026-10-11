import { onTopics } from '../utils/live'

const HEARTBEAT_MS = 25_000

export default defineEventHandler((event) => {
  const stream = createEventStream(event)
  const off = onTopics(topics => void stream.push({ event: 'topics', data: JSON.stringify(topics) }))
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
