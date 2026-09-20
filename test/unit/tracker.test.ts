import { describe, expect, it } from 'vitest'
import { matchTrackerEvent, trackerComment, trackerContext, trackerStatusChange, trackerTriggerForm, type TrackerChange, type TrackerDef } from '../../server/integrations/tracker'
import { htmlMentionIds } from '../../server/integrations/plane/html'
import type { TriggerConfig, TriggerEventConfig } from '../../shared/utils/trigger-form'

const DEF: TrackerDef = {
  name: 'Tracker',
  noun: 'ticket',
  defaultEvent: 'labeled',
  labelValue: { input: 'text' },
  status: { event: 'status', groupPrefix: 'group:', groupHeading: 'Group', groups: { open: 'Open', done: 'Done' }, closedGroups: ['done'], optionsUrl: '/x' },
  filters: [],
}

function change(overrides: Partial<TrackerChange> = {}, issue: Partial<TrackerChange['issue']> = {}): TrackerChange {
  return {
    created: false,
    issue: {
      object: { integration: 'jira', kind: 'issue', key: 'P-1', url: 'https://x/P-1', title: 'Login broken' },
      body: 'It fails.',
      status: { name: 'Todo', group: 'open' },
      author: 'Ann',
      assignees: ['Bob', 'Knecht'],
      labels: ['bug'],
      ...issue,
    },
    gainedLabels: [],
    assignedToSelf: false,
    gainedSelf: false,
    filterValues: {},
    ...overrides,
  }
}

const config = (on: TriggerEventConfig[], filters: TriggerConfig['filters'] = {}): TriggerConfig => ({ kind: 'issue', on, filters })
const fires = (c: TriggerConfig, ch: TrackerChange) => matchTrackerEvent(DEF, c, ch) !== null

describe('matchTrackerEvent', () => {
  it('hands the issue over as inputs and object', () => {
    expect(matchTrackerEvent(DEF, config([{ type: 'created' }]), change({ created: true }))).toEqual({
      branch: null,
      object: change().issue.object,
      inputs: { event: 'issue', identifier: 'P-1', title: 'Login broken', body: 'It fails.', url: 'https://x/P-1', status: 'Todo', assignee: 'Bob, Knecht', labels: 'bug', author: 'Ann' },
    })
  })

  it('fires created only on creation', () => {
    expect(fires(config([{ type: 'created' }]), change())).toBe(false)
  })

  it('fires a label when gained, or when the object is born with it', () => {
    const labeled = config([{ type: 'labeled', value: 'bug' }])
    expect(fires(labeled, change())).toBe(false)
    expect(fires(labeled, change({ gainedLabels: ['bug'] }))).toBe(true)
    expect(fires(labeled, change({ created: true }))).toBe(true)
    expect(fires(labeled, change({ created: true }, { labels: [] }))).toBe(false)
  })

  it('fires assigned when Knecht gains the object, or is born with it', () => {
    const assigned = config([{ type: 'assigned' }])
    expect(fires(assigned, change({ assignedToSelf: true }))).toBe(false)
    expect(fires(assigned, change({ gainedSelf: true }))).toBe(true)
    expect(fires(assigned, change({ created: true, assignedToSelf: true }))).toBe(true)
  })

  it('fires an exact status only when this update changed the status', () => {
    const status = config([{ type: 'status', value: 'Todo' }])
    expect(fires(status, change())).toBe(false)
    expect(fires(status, change({ previousStatus: { group: 'open' } }))).toBe(true)
    expect(fires(status, change({ created: true }))).toBe(true)
  })

  it('fires a status group only when the object enters it', () => {
    const group = config([{ type: 'status', value: 'group:open' }])
    expect(fires(group, change({ previousStatus: { group: 'open' } }))).toBe(false)
    expect(fires(group, change({ previousStatus: { group: 'done' } }))).toBe(true)
    expect(fires(group, change({ previousStatus: { group: null } }))).toBe(true)
    expect(fires(group, change({ previousStatus: { group: 'open' } }, { status: { name: 'Done', group: 'done' } }))).toBe(false)
  })

  it('holds back what the label and the extra filters exclude', () => {
    const created = (filters: TriggerConfig['filters']) => config([{ type: 'created' }], filters)
    const born = change({ created: true, filterValues: { priority: ['High'] } })
    expect(fires(created({ label: ['b*'] }), born)).toBe(true)
    expect(fires(created({ label: ['Bug'] }), born)).toBe(false)
    expect(fires(created({ priority: ['urgent', 'high'] }), born)).toBe(true)
    expect(fires(created({ priority: ['low'] }), born)).toBe(false)
  })
})

describe('trackerStatusChange', () => {
  it('closes and reopens by the status group, only on a status change', () => {
    expect(trackerStatusChange(DEF, change())).toBeUndefined()
    expect(trackerStatusChange(DEF, change({ created: true }))).toBeUndefined()
    expect(trackerStatusChange(DEF, change({ previousStatus: { group: 'done' } }))?.status).toBe('open')
    expect(trackerStatusChange(DEF, change({ previousStatus: { group: 'open' } }, { status: { name: 'Done', group: 'done' } }))?.status).toBe('closed')
  })
})

describe('trackerComment', () => {
  const comment = (body: string, authorId: string, mentionedIds: string[] = [], selfId: string | null = 'knecht') =>
    trackerComment({ id: '1', author: { id: authorId, name: authorId }, body, object: change().issue.object, selfId, mentionedIds })

  it('reads a structured mention of the connection account and the plain handle', () => {
    expect(comment('please', 'ann', ['knecht']).mentionsKnecht).toBe(true)
    expect(comment('@Knecht please', 'ann').mentionsKnecht).toBe(true)
    expect(comment('please', 'ann', ['bob']).mentionsKnecht).toBe(false)
    expect(comment('mail knecht@acme.test', 'ann').mentionsKnecht).toBe(false)
  })

  it('marks comments of the connection account as its own', () => {
    expect(comment('@knecht done', 'knecht').fromSelf).toBe(true)
    expect(comment('@knecht done', 'ann').fromSelf).toBe(false)
    expect(comment('@knecht done', '', [], '').fromSelf).toBe(false)
  })
})

describe('trackerContext', () => {
  it('prints the same facts for every tracker', () => {
    const text = trackerContext({ ...change().issue, facts: [['Type', 'Bug']] }, [{ author: 'Ann', at: new Date('2026-01-02'), body: 'any news?' }])
    expect(text).toBe([
      '# P-1: Login broken',
      'https://x/P-1',
      'Type: Bug · Status: Todo · Author: Ann · Assignees: Bob, Knecht · Labels: bug',
      '',
      'It fails.',
      '',
      '## Comments (newest last)',
      '',
      '**Ann** (2026-01-02):\nany news?',
    ].join('\n'))
  })
})

describe('trackerTriggerForm', () => {
  it('offers exactly the events the matcher understands', () => {
    const [kind] = trackerTriggerForm(DEF)
    expect(kind!.label).toBe('Ticket')
    expect(kind!.events.map(e => e.type)).toEqual(['created', 'assigned', 'labeled', 'status'])
    expect(kind!.events.find(e => e.default)?.type).toBe('labeled')
    expect(kind!.events.at(-1)!.value).toMatchObject({ default: 'group:done', options: [{ value: 'group:open' }, { value: 'group:done' }] })
  })
})

describe('htmlMentionIds', () => {
  it('reads ids from mention nodes only', () => {
    const html = '<p><mention-component entity_identifier="u-1" entity_name="user_mention" label="Knecht"></mention-component> see <a href="https://x/u-2">u-2</a></p>'
    expect(htmlMentionIds(html)).toContain('u-1')
    expect(htmlMentionIds(html)).not.toContain('u-2')
  })
})
