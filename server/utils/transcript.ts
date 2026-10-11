import type { AgentItem, Followup } from '../db/schema'
import { emitLive } from './live'
import { listSessionRunSummaries } from '../stores/runs'
import type { followupColumns } from '../stores/followups'
import { getFollowupView, listSessionFollowupViews } from '../stores/followups'
import { listAgentItems } from '../stores/agent-items'

export type FollowupView = Pick<Followup, keyof typeof followupColumns>
export type AgentItemView = Omit<AgentItem, 'sessionId'>

export function itemView({ sessionId: _sessionId, ...item }: AgentItem): AgentItemView {
  return item
}

export function followupView(id: number): FollowupView | undefined {
  const row = getFollowupView(id)
  if (!row) return
  const { sessionId: _sessionId, ...followup } = row
  return followup
}

export function emitItem(item: AgentItem): void {
  emitLive({ type: 'item', sessionId: item.sessionId, item: itemView(item) })
}

export function emitFollowup(id: number): void {
  const row = getFollowupView(id)
  if (!row) return
  const { sessionId, ...followup } = row
  emitLive({ type: 'followup', sessionId, followup })
}

export function sessionTranscript(sessionId: number) {
  const followups = listSessionFollowupViews(sessionId)
  const items = listAgentItems(followups.map(f => f.id))
  const runs = listSessionRunSummaries(sessionId)
  return {
    runs,
    followups: followups.map(f => ({
      ...f,
      items: items.filter(i => i.followupId === f.id).map(itemView),
    })),
  }
}
