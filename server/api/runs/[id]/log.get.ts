import { onRunLog, type RunLogChunk } from '../../../utils/live'
import { sendEventStream } from '../../../utils/sse'
import { readRunLog, requireRun } from '../../../stores/runs'

// Event ids are byte offsets: on a reconnect EventSource sends the last one back, and the stream resumes there.
export default defineEventHandler((event) => {
  const run = requireRun(requireIntParam(event))
  const from = Number(getHeader(event, 'last-event-id')) || 0
  return sendEventStream(event, (push) => {
    const send = ({ text, end }: RunLogChunk) => push({ id: String(end), event: 'log', data: JSON.stringify(text) })
    const off = onRunLog(run.id, send)
    send(readRunLog(run.id, from))
    return off
  })
})
