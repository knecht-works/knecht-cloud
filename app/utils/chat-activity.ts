import { COMPACT_COMMAND } from '#shared/utils/followup'

type Status = 'pending' | 'in_progress' | 'completed' | 'failed' | null

export interface ActivityItem {
  id: number
  type: string
  kind: string | null
  status: Status
  text: string
}

export interface ActivityTurn<I extends ActivityItem = ActivityItem> {
  status: 'queued' | 'running' | 'success' | 'failed'
  origin: string
  prompt: string
  items: I[]
}

const live = (turn: Pick<ActivityTurn, 'status'>) => turn.status === 'queued' || turn.status === 'running'
const running = (item: ActivityItem) => item.type === 'tool' && (item.status === 'pending' || item.status === 'in_progress')

// A reply is its turn plus the agent turns that continue it; they read as one answer.
export function replyItems<I extends ActivityItem>(turns: ActivityTurn<I>[]): I[] {
  const items = turns.flatMap(turn => live(turn)
    ? turn.items
    : turn.items.map(i => running(i) ? { ...i, status: turn.status === 'failed' ? 'failed' : 'completed' } : i))
  const lastPreview = items.findLastIndex(i => i.type === 'tool' && i.kind === 'preview')
  return items.filter((i, n) => !(i.type === 'tool' && i.kind === 'preview' && n < lastPreview))
}

// One line that is there for as long as the reply is still being made, unless a running tool row already says so.
export function replyActivity(turns: ActivityTurn[]): string | null {
  const current = turns.find(live)
  if (!current) return null
  if (replyItems(turns).some(running)) return null
  if (current.prompt === COMPACT_COMMAND) return 'Compacting the conversation'
  if (current.origin === 'agent' && !current.items.length) return 'Booting the preview'
  if (current.status === 'queued') return 'Starting the agent'
  return 'Knechting'
}
