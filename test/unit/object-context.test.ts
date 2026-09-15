import { describe, expect, it } from 'vitest'
import { formatObjectContext } from '../../server/utils/object-context'

describe('formatObjectContext', () => {
  it('renders heading, facts, body and the newest comments last', () => {
    const text = formatObjectContext({
      heading: 'PROJ-1: Login broken',
      url: 'https://x/browse/PROJ-1',
      facts: [['Status', 'To Do'], ['Assignee', ''], ['Labels', 'knecht, bug']],
      body: 'It fails on submit.',
      comments: Array.from({ length: 12 }, (_, i) => ({ author: `User ${i}`, at: new Date(Date.UTC(2026, 0, i + 1)), body: `comment ${i}` })),
    })
    expect(text).toBe([
      '# PROJ-1: Login broken',
      'https://x/browse/PROJ-1',
      'Status: To Do · Labels: knecht, bug',
      '',
      'It fails on submit.',
      '',
      '## Comments (newest last, 10 of 12)',
      '',
      ...Array.from({ length: 10 }, (_, i) => `**User ${i + 2}** (2026-01-${String(i + 3).padStart(2, '0')}):\ncomment ${i + 2}`).flatMap(c => [c, '']),
    ].join('\n').trimEnd())
  })

  it('leaves out empty parts', () => {
    expect(formatObjectContext({ heading: 'Issue #5: Broken', url: '', facts: [], body: '', comments: [] }))
      .toBe('# Issue #5: Broken\n\n(no description)')
  })
})
