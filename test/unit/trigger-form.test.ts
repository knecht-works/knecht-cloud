import { describe, expect, it } from 'vitest'
import { defaultTriggerConfig, segmentsText, triggerConfigIssues, triggerEventLabel, triggerSummary, type TriggerFormDef } from '../../shared/utils/trigger-form'
import { allOf, noneOf } from '../helpers/trigger-conditions'

const FORM: TriggerFormDef = [
  {
    kind: 'card',
    label: 'Card',
    events: [
      { type: 'created', label: 'Created', summary: 'created', default: true },
      { type: 'labeled', label: 'Label added', summary: 'label {value}', value: { default: 'go' }, default: true },
      { type: 'moved', label: 'Moved to', summary: 'moved to {value}', value: { options: [{ label: 'Doing', value: 'doing' }, { label: 'Done', value: 'done' }] } },
    ],
    filters: [
      { key: 'board', label: 'Board' },
      { key: 'size', label: 'Size', listedOnly: true, options: [{ label: 'S', value: 's' }, { label: 'L', value: 'l' }] },
    ],
  },
  {
    kind: 'list',
    label: 'List',
    events: [{
      type: 'state',
      label: 'State reached',
      summary: 'state {value}',
      value: { options: [{ label: 'Done', value: 'group:done', summary: 'any "Done" state' }], optionsUrl: '/api/states' },
    }],
    filters: [],
  },
  { kind: 'board', label: 'Board', events: [{ type: 'created', label: 'Created', summary: 'created' }], filters: [] },
]

describe('trigger form', () => {
  it('starts a new trigger from the events marked as default', () => {
    expect(defaultTriggerConfig(FORM)).toEqual({ kind: 'card', on: [{ type: 'created' }, { type: 'labeled', values: ['go'] }], conditions: [] })
    expect(defaultTriggerConfig(FORM, 'board')).toEqual({ kind: 'board', on: [], conditions: [] })
  })

  it('accepts a config made of declared events and conditions, a field more than once', () => {
    expect(triggerConfigIssues(FORM, defaultTriggerConfig(FORM))).toEqual([])
    expect(triggerConfigIssues(FORM, { kind: 'card', on: [{ type: 'moved', values: ['done'] }], conditions: allOf({ board: ['ops'], size: ['s'] }) })).toEqual([])
    expect(triggerConfigIssues(FORM, { kind: 'card', on: [{ type: 'created' }], conditions: [[...allOf({ board: ['o*'] })[0]!, ...noneOf({ board: ['ops'] })[0]!]] })).toEqual([])
  })

  it.each([
    [{ kind: 'lane', on: [{ type: 'created' }], conditions: [] }, 'Unknown trigger kind "lane"'],
    [{ kind: 'card', on: [], conditions: [] }, 'Pick at least one event.'],
    [{ kind: 'board', on: [{ type: 'labeled', values: ['go'] }], conditions: [] }, 'Unknown event "labeled"'],
    [{ kind: 'card', on: [{ type: 'created' }, { type: 'created' }], conditions: [] }, '"Created" is listed twice'],
    [{ kind: 'card', on: [{ type: 'created', values: ['x'] }], conditions: [] }, '"Created" takes no value'],
    [{ kind: 'card', on: [{ type: 'labeled', values: [' '] }], conditions: [] }, '"Label added" needs a value.'],
    [{ kind: 'card', on: [{ type: 'moved', values: ['gone'] }], conditions: [] }, '"gone" is not an option of "Moved to"'],
    [{ kind: 'card', on: [{ type: 'created' }], conditions: allOf({ team: ['a'] }) }, 'Unknown condition "team"'],
    [{ kind: 'card', on: [{ type: 'created' }], conditions: allOf({ board: ['ops', ''] }) }, 'Fill in or remove the "Board" condition.'],
    [{ kind: 'card', on: [{ type: 'created' }], conditions: allOf({ size: ['s', 'x*'] }) }, '"x*" is not an option of "Size"'],
    [{ kind: 'card', on: [{ type: 'created' }], conditions: [[]] }, 'Fill in or remove the empty condition group.'],
  ])('rejects %o', (config, message) => {
    expect(triggerConfigIssues(FORM, config)[0]?.message).toBe(message)
  })

  it('takes any value where options also load per project, and lets an option word the summary', () => {
    expect(triggerConfigIssues(FORM, { kind: 'list', on: [{ type: 'state', values: ['In Review'] }], conditions: [] })).toEqual([])
    expect(triggerEventLabel(triggerSummary(FORM, { kind: 'list', on: [{ type: 'state', values: ['In Review'] }], conditions: [] }))).toBe('On list · state In Review')
    expect(triggerEventLabel(triggerSummary(FORM, { kind: 'list', on: [{ type: 'state', values: ['group:done'] }], conditions: [] }))).toBe('On list · any "Done" state')
  })

  it('names the event or condition every issue belongs to', () => {
    expect(triggerConfigIssues(FORM, { kind: 'card', on: [{ type: 'labeled', values: [''] }, { type: 'moved' }], conditions: [...allOf({ board: ['ops'] }), ...allOf({ board: ['dev'], size: ['s'], team: ['a'] })] })).toEqual([
      { message: '"Label added" needs a value.', event: 'labeled' },
      { message: '"Moved to" needs a value.', event: 'moved' },
      { message: 'Unknown condition "team"', condition: [1, 2] },
    ])
    expect(triggerConfigIssues(FORM, { kind: 'card', on: [], conditions: [] })).toEqual([{ message: 'Pick at least one event.' }])
  })

  it('summarises kind, events and conditions, showing option labels', () => {
    const on = [{ type: 'created' }, { type: 'moved', values: ['done'] }]
    const summary = triggerSummary(FORM, { kind: 'card', on, conditions: allOf({ board: ['ops', 'dev'], size: ['s'] }) })
    expect(summary.kind).toBe('Card')
    expect(summary.events.map(segmentsText)).toEqual(['created', 'moved to Done'])
    expect(summary.events[1]).toEqual([{ kind: 'text', text: 'moved to ' }, { kind: 'value', text: 'Done' }])
    expect(summary.conditions.map(g => g.map(segmentsText))).toEqual([['board is ops, dev', 'size is S']])
    const negated = triggerSummary(FORM, { kind: 'card', on, conditions: [...noneOf({ board: ['ops'] }), ...allOf({ board: ['dev'], size: ['s', 'l'] })] }).conditions
    expect(negated.map(g => g.map(segmentsText))).toEqual([['board is not ops'], ['board is dev', 'size is S, L']])
    expect(negated[0]![0]!.map(s => s.kind)).toEqual(['text', 'not', 'text', 'value'])
    expect(triggerEventLabel(triggerSummary([FORM[0]!], { kind: 'card', on: [{ type: 'labeled', values: ['go'] }], conditions: [] }))).toBe('On label go')
  })
})
