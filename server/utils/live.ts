import { EventEmitter } from 'node:events'
import type { AgentItemView, FollowupView } from './transcript'

export type LiveEvent
  = | { type: 'item', sessionId: number, item: AgentItemView }
    | { type: 'followup', sessionId: number, followup: FollowupView }
    | { type: 'followup-removed', sessionId: number, id: number }
    | { type: 'followup-reset', sessionId: number, followup: FollowupView }

const bus = new EventEmitter()
bus.setMaxListeners(0)

export function emitLive(event: LiveEvent): void {
  bus.emit(`session:${event.sessionId}`, event)
}

export function onLive(sessionId: number, handler: (event: LiveEvent) => void): () => void {
  const name = `session:${sessionId}`
  bus.on(name, handler)
  return () => bus.off(name, handler)
}

// A window rather than a microtask: a streaming run log would otherwise push an event per line.
const TOPIC_WINDOW_MS = 100
const pendingTopics = new Set<string>()
let topicTimer: ReturnType<typeof setTimeout> | undefined

export function emitTopics(...topics: string[]): void {
  for (const topic of topics) pendingTopics.add(topic)
  topicTimer ??= setTimeout(() => {
    topicTimer = undefined
    const batch = [...pendingTopics]
    pendingTopics.clear()
    bus.emit('topics', batch)
  }, TOPIC_WINDOW_MS).unref()
}

export function onTopics(handler: (topics: string[]) => void): () => void {
  bus.on('topics', handler)
  return () => bus.off('topics', handler)
}
