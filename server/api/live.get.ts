import { onTopics } from '../utils/live'
import { sendEventStream } from '../utils/sse'
import { defineEventHandler } from 'h3'

export default defineEventHandler(event =>
  sendEventStream(event, push => onTopics(topics => push({ event: 'topics', data: JSON.stringify(topics) }))))
