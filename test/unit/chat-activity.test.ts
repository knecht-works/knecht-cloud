import { describe, expect, it } from 'vitest'
import { replyActivity, replyItems, type ActivityTurn } from '~/utils/chat-activity'

type Item = ActivityTurn['items'][number]

const tool = (id: number, status: Item['status'], kind = 'execute'): Item => ({ id, type: 'tool', kind, status, text: `tool ${id}` })
const message = (id: number): Item => ({ id, type: 'message', kind: null, status: null, text: `message ${id}` })
const turn = (status: ActivityTurn['status'], items: Item[] = [], extra: Partial<ActivityTurn> = {}): ActivityTurn =>
  ({ status, origin: 'dashboard', prompt: 'do it', items, ...extra })

describe('replyActivity', () => {
  it('is quiet once every turn of the reply is done', () => {
    expect(replyActivity([turn('success', [tool(1, 'completed'), message(2)])])).toBeNull()
  })

  it('says the agent is starting before the turn produced anything', () => {
    expect(replyActivity([turn('queued')])).toBe('Starting the agent')
  })

  it('keeps saying the agent thinks between tool calls and while it writes', () => {
    expect(replyActivity([turn('running', [tool(1, 'completed')])])).toBe('Thinking')
    expect(replyActivity([turn('running', [tool(1, 'completed'), message(2)])])).toBe('Thinking')
  })

  it('leaves the signal to a tool row while that tool runs', () => {
    expect(replyActivity([turn('running', [tool(1, 'in_progress')])])).toBeNull()
  })

  it('stays on while the turn after a preview request waits to start', () => {
    const asked = turn('success', [tool(1, 'completed', 'preview')])
    expect(replyActivity([asked, turn('queued', [], { origin: 'agent' })])).toBe('Booting the preview')
  })

  it('names the compaction while it runs', () => {
    expect(replyActivity([turn('running', [], { prompt: '/compact' })])).toBe('Compacting the conversation')
  })
})

describe('replyItems', () => {
  it('drops a preview request once the boot it asked for shows up', () => {
    const asked = turn('success', [message(1), tool(2, 'completed', 'preview')])
    const boot = turn('running', [tool(3, 'in_progress', 'preview'), message(4)], { origin: 'agent' })
    expect(replyItems([asked, boot]).map(i => i.id)).toEqual([1, 3, 4])
  })

  it('stops a tool spinner when its turn ended without the tool finishing', () => {
    expect(replyItems([turn('success', [tool(1, 'in_progress')])])[0]!.status).toBe('completed')
    expect(replyItems([turn('failed', [tool(1, 'pending')])])[0]!.status).toBe('failed')
    expect(replyItems([turn('running', [tool(1, 'in_progress')])])[0]!.status).toBe('in_progress')
  })
})
