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
