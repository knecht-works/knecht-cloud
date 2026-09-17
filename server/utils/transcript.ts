import { asc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import type { AgentItem, Followup } from '../db/schema'
import { emitLive } from './live'

export const followupColumns = {
  id: schema.followups.id,
  runId: schema.followups.runId,
  prompt: schema.followups.prompt,
  model: schema.followups.model,
  attachments: schema.followups.attachments,
  requestedBy: schema.followups.requestedBy,
  origin: schema.followups.origin,
  status: schema.followups.status,
  error: schema.followups.error,
  createdAt: schema.followups.createdAt,
  startedAt: schema.followups.startedAt,
  finishedAt: schema.followups.finishedAt,
}

export type FollowupView = Pick<Followup, keyof typeof followupColumns>
export type AgentItemView = Omit<AgentItem, 'sessionId'>

export function itemView({ sessionId: _sessionId, ...item }: AgentItem): AgentItemView {
  return item
}

export function followupView(id: number): FollowupView | undefined {
  return db.select(followupColumns).from(schema.followups).where(eq(schema.followups.id, id)).get()
}

export function emitItem(item: AgentItem): void {
  emitLive({ type: 'item', sessionId: item.sessionId, item: itemView(item) })
}

export function emitFollowup(id: number): void {
  const row = db.select({ ...followupColumns, sessionId: schema.followups.sessionId }).from(schema.followups).where(eq(schema.followups.id, id)).get()
  if (!row) return
  const { sessionId, ...followup } = row
  emitLive({ type: 'followup', sessionId, followup })
}

export function listAgentItems(followupIds: number[]): AgentItem[] {
  if (!followupIds.length) return []
  return db.select().from(schema.agentItems)
    .where(inArray(schema.agentItems.followupId, followupIds))
    .orderBy(asc(schema.agentItems.followupId), asc(schema.agentItems.seq))
    .all()
}

export function sessionTranscript(sessionId: number) {
  const followups = db.select(followupColumns).from(schema.followups)
    .where(eq(schema.followups.sessionId, sessionId))
    .orderBy(asc(schema.followups.id))
    .all()
  const items = listAgentItems(followups.map(f => f.id))
  const runs = db.select({
    id: schema.runs.id,
    workflow: schema.runs.workflow,
    kind: schema.runs.kind,
    status: schema.runs.status,
    prUrl: schema.runs.prUrl,
    createdAt: schema.runs.createdAt,
    finishedAt: schema.runs.finishedAt,
  }).from(schema.runs)
    .where(eq(schema.runs.sessionId, sessionId))
    .orderBy(asc(schema.runs.id))
    .all()
  return {
    runs,
    followups: followups.map(f => ({
      ...f,
      items: items.filter(i => i.followupId === f.id).map(itemView),
    })),
  }
}
