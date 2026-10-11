import { createEventStream, type EventStreamMessage, type H3Event } from 'h3'

const HEARTBEAT_MS = 25_000

export type PushEvent = (message: EventStreamMessage) => void

export function sendEventStream(event: H3Event, subscribe: (push: PushEvent) => () => void) {
  const stream = createEventStream(event)
  // Headers only go out with the first chunk; the browser's "open" waits for them.
  void stream.push({ event: 'ready', data: '' })
  const off = subscribe(message => void stream.push(message))
  const heartbeat = setInterval(() => void stream.push({ event: 'ping', data: '' }), HEARTBEAT_MS)
  stream.onClosed(async () => {
    off()
    clearInterval(heartbeat)
    await stream.close()
  })
  return stream.send()
}
