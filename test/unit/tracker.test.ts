import { describe, expect, it } from 'vitest'
import { matchTrackerEvent, trackerComment, trackerStatusChange, trackerTriggerForm, type TrackerChange, type TrackerDef } from '../../server/integrations/tracker'
import { htmlMentionIds } from '../../server/integrations/plane/html'
import type { TriggerConfig, TriggerEventConfig } from '../../shared/utils/trigger-form'
import { allOf, noneOf } from '../helpers/trigger-conditions'

const DEF: TrackerDef = {
  id: 'jira',
  name: 'Tracker',
  noun: 'ticket',
  status: { event: 'status', groupPrefix: 'group:', groupHeading: 'Group', groups: { open: 'Open', done: 'Done' }, closedGroups: ['done'], options: 'statuses' },
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

const config = (event: TriggerEventConfig, fields: Record<string, string[]> = {}, scope?: string[]): TriggerConfig =>
  ({ kind: 'issue', event, conditions: allOf(fields), ...(scope ? { scope: { values: scope } } : {}) })
const entered = (scope: string[]) => config({ type: 'entered' }, {}, scope)
const fires = (c: TriggerConfig, ch: TrackerChange) => matchTrackerEvent(DEF, c, ch) !== null

describe('matchTrackerEvent', () => {
  it('hands the issue over as inputs and object', () => {
    expect(matchTrackerEvent(DEF, config({ type: 'created' }), change({ created: true }))).toEqual({
      branch: null,
      object: change().issue.object,
      inputs: { event: 'issue', identifier: 'P-1', title: 'Login broken', body: 'It fails.', url: 'https://x/P-1', status: 'Todo', assignee: 'Bob, Knecht', labels: 'bug', author: 'Ann' },
      actor: null,
    })
  })

  it('names who made the change, so Knecht can hand the object back to them', () => {
    const actor = { id: 'u-7', name: 'Sam' }
    expect(matchTrackerEvent(DEF, config({ type: 'created' }), change({ created: true, actor }))).toMatchObject({ actor })
  })

  it('fires created only on creation', () => {
    expect(fires(config({ type: 'created' }), change())).toBe(false)
  })

  it('fires only the configured event', () => {
    expect(fires(config({ type: 'created' }), change({ gainedLabels: ['bug'], gainedSelf: true, previousStatus: { group: 'done' } }))).toBe(false)
    expect(fires(config({ type: 'assigned' }), change({ created: true }))).toBe(false)
  })

  it('fires a label when gained, or when the object is born with it', () => {
    const labeled = config({ type: 'labeled', values: ['bug'] })
    expect(fires(labeled, change())).toBe(false)
    expect(fires(labeled, change({ gainedLabels: ['bug'] }))).toBe(true)
    expect(fires(labeled, change({ created: true }))).toBe(true)
    expect(fires(labeled, change({ created: true }, { labels: [] }))).toBe(false)
  })

  it('fires assigned when Knecht gains the object, or is born with it', () => {
    const assigned = config({ type: 'assigned' })
    expect(fires(assigned, change({ assignedToSelf: true }))).toBe(false)
    expect(fires(assigned, change({ gainedSelf: true }))).toBe(true)
    expect(fires(assigned, change({ created: true, assignedToSelf: true }))).toBe(true)
  })

  it('fires entered on an exact status only when this update changed the status', () => {
    const status = entered(['Todo'])
    expect(fires(status, change())).toBe(false)
    expect(fires(status, change({ previousStatus: { group: 'open' } }))).toBe(true)
    expect(fires(status, change({ created: true }))).toBe(false)
  })

  it('fires entered on a status group only when the object enters it', () => {
    const group = entered(['group:open'])
    expect(fires(group, change({ previousStatus: { group: 'open' } }))).toBe(false)
    expect(fires(group, change({ previousStatus: { group: 'done' } }))).toBe(true)
    expect(fires(group, change({ previousStatus: { group: null } }))).toBe(true)
    expect(fires(group, change({ previousStatus: { group: 'open' } }, { status: { name: 'Done', group: 'done' } }))).toBe(false)
    const either = entered(['group:done', 'In Review'])
    expect(fires(either, change({ previousStatus: { group: 'open' } }, { status: { name: 'In Review', group: 'open' } }))).toBe(true)
    expect(fires(either, change({ previousStatus: { group: 'open' } }, { status: { name: 'Shipped', group: 'done' } }))).toBe(true)
    expect(fires(either, change({ previousStatus: { group: 'open' } }))).toBe(false)
  })

  it('never fires entered without a scope', () => {
    expect(fires(config({ type: 'entered' }), change({ previousStatus: { group: 'done' } }))).toBe(false)
  })

  it('holds back what the label and the extra filters exclude', () => {
    const created = (fields: Record<string, string[]>) => config({ type: 'created' }, fields)
    const born = change({ created: true, filterValues: { priority: ['high'] } })
    expect(fires(created({ label: ['b*'] }), born)).toBe(true)
    expect(fires(created({ label: ['Bug'] }), born)).toBe(false)
    expect(fires(created({ priority: ['urgent', 'high'] }), born)).toBe(true)
    expect(fires(created({ priority: ['low'] }), born)).toBe(false)
    const listed: TrackerDef = { ...DEF, filters: [{ key: 'priority', label: 'Priority', listedOnly: true }] }
    expect(matchTrackerEvent(DEF, created({ priority: ['h*'] }), born)).not.toBeNull()
    expect(matchTrackerEvent(listed, created({ priority: ['h*'] }), born)).toBeNull()
    expect(matchTrackerEvent(listed, created({ priority: ['high'] }), born)).not.toBeNull()
  })

  it('holds another event back by the scope the issue has to be in', () => {
    const labeled = (scope?: string[]) => config({ type: 'labeled', values: ['bug'] }, {}, scope)
    const gained = (status: { name: string, group: string }) => change({ gainedLabels: ['bug'] }, { status })
    expect(fires(labeled(), gained({ name: 'Shipped', group: 'done' }))).toBe(true)
    expect(fires(labeled(['In Review']), gained({ name: 'In Review', group: 'open' }))).toBe(true)
    expect(fires(labeled(['In Review']), gained({ name: 'Todo', group: 'open' }))).toBe(false)
    expect(fires(labeled(['In *']), gained({ name: 'In Review', group: 'open' }))).toBe(false)
    expect(fires(labeled(['group:open']), gained({ name: 'Todo', group: 'open' }))).toBe(true)
    expect(fires(labeled(['group:open', 'Shipped']), gained({ name: 'Shipped', group: 'done' }))).toBe(true)
  })

  it('holds an event back by who it is assigned to', () => {
    const labeled = (conditions: TriggerConfig['conditions']) => ({ ...config({ type: 'labeled', values: ['bug'] }), conditions })
    const gained = (assignedToSelf = false) => change({ gainedLabels: ['bug'], assignedToSelf })
    expect(fires(labeled(allOf({ assignee: ['self'] })), gained(true))).toBe(true)
    expect(fires(labeled(allOf({ assignee: ['self'] })), gained())).toBe(false)
    expect(fires(labeled(noneOf({ assignee: ['self'] })), gained())).toBe(true)
  })

  it('no longer reads the status as a condition', () => {
    expect(fires(config({ type: 'labeled', values: ['bug'] }, { status: ['Todo'] }), change({ gainedLabels: ['bug'] }))).toBe(false)
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

describe('trackerTriggerForm', () => {
  it('offers exactly the events, scope and conditions the matcher understands', () => {
    const [kind] = trackerTriggerForm(DEF)
    expect(kind!.label).toBe('Ticket')
    expect(kind!.events.map(e => e.type)).toEqual(['created', 'assigned', 'labeled', 'entered'])
    expect(kind!.events.find(e => e.default)?.type).toBe('assigned')
    expect(kind!.events.find(e => e.type === 'labeled')!.value).toMatchObject({ optionsUrl: '/api/integrations/jira/options/labels' })
    expect(kind!.events.find(e => e.type === 'entered')!.value).toBeUndefined()
    expect(kind!.filters.map(f => f.key)).toEqual(['assignee'])
    expect(kind!.scope).toMatchObject({ label: 'Status', requiredBy: ['entered'], listedOnly: true, optionsUrl: '/api/integrations/jira/options/statuses', options: [{ value: 'group:open' }, { value: 'group:done' }] })
  })
})

describe('htmlMentionIds', () => {
  it('reads ids from mention nodes only', () => {
    const html = '<p><mention-component entity_identifier="u-1" entity_name="user_mention"></mention-component> see <a href="https://x/u-2">u-2</a></p>'
    expect(htmlMentionIds(html)).toContain('u-1')
    expect(htmlMentionIds(html)).not.toContain('u-2')
  })
})
