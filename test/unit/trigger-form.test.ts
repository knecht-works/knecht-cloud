import { describe, expect, it } from 'vitest'
import { defaultTriggerConfig, segmentsText, triggerConfigIssues, triggerEventLabel, triggerSummary, type TriggerConfig, type TriggerFormDef } from '../../shared/utils/trigger-form'
import { allOf, noneOf } from '../helpers/trigger-conditions'

const FORM: TriggerFormDef = [
  {
    kind: 'card',
    label: 'Card',
    events: [
      { type: 'created', label: 'Created', summary: 'created' },
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
    events: [
      { type: 'created', label: 'Created', summary: 'list created' },
      { type: 'entered', label: 'State reached', summary: 'state {value}' },
    ],
    scope: {
      label: 'State',
      requiredBy: ['entered'],
      options: [{ label: 'Any Done', value: 'group:done', summary: 'any "Done" state' }],
      optionsUrl: '/api/states',
    },
    filters: [],
  },
  { kind: 'board', label: 'Board', events: [{ type: 'created', label: 'Created', summary: 'created' }], filters: [] },
]

const card = (event: TriggerConfig['event'], conditions: TriggerConfig['conditions'] = []): TriggerConfig => ({ kind: 'card', event, conditions })
const list = (event: TriggerConfig['event'], scope?: string[]): TriggerConfig => ({ kind: 'list', event, conditions: [], ...(scope ? { scope: { values: scope } } : {}) })

describe('trigger form', () => {
  it('starts a new trigger from the event marked as default, or the first one', () => {
    expect(defaultTriggerConfig(FORM)).toEqual({ kind: 'card', event: { type: 'labeled', values: ['go'] }, conditions: [] })
    expect(defaultTriggerConfig(FORM, 'board')).toEqual({ kind: 'board', event: { type: 'created' }, conditions: [] })
  })

  it('accepts a config made of a declared event and conditions, a field more than once', () => {
    expect(triggerConfigIssues(FORM, defaultTriggerConfig(FORM))).toEqual([])
    expect(triggerConfigIssues(FORM, card({ type: 'moved', values: ['done'] }, allOf({ board: ['ops'], size: ['s'] })))).toEqual([])
    expect(triggerConfigIssues(FORM, card({ type: 'created' }, [...allOf({ board: ['o*'] }), ...noneOf({ board: ['ops'] })]))).toEqual([])
  })

  it.each([
    [{ kind: 'lane', event: { type: 'created' }, conditions: [] }, 'Unknown trigger kind "lane"'],
    [{ kind: 'board', event: { type: 'labeled', values: ['go'] }, conditions: [] }, 'Unknown event "labeled"'],
    [card({ type: 'created', values: ['x'] }), '"Created" takes no value'],
    [card({ type: 'labeled', values: [' '] }), '"Label added" needs a value.'],
    [card({ type: 'moved', values: ['gone'] }), '"gone" is not an option of "Moved to"'],
    [card({ type: 'created' }, allOf({ team: ['a'] })), 'Unknown condition "team"'],
    [card({ type: 'created' }, allOf({ board: ['ops', ''] })), 'Fill in or remove the "Board" condition.'],
    [card({ type: 'created' }, allOf({ size: ['s', 'x*'] })), '"x*" is not an option of "Size"'],
    [{ ...card({ type: 'created' }), scope: { values: ['done'] } }, 'This trigger takes no scope'],
    [list({ type: 'entered' }), '"State reached" needs a state.'],
    [list({ type: 'entered' }, ['Done', ' ']), 'Fill in or remove the "State".'],
  ])('rejects %o', (config, message) => {
    expect(triggerConfigIssues(FORM, config)[0]?.message).toBe(message)
  })

  it('requires the scope only for the events that target it', () => {
    expect(triggerConfigIssues(FORM, list({ type: 'entered' }, ['In Review']))).toEqual([])
    expect(triggerConfigIssues(FORM, list({ type: 'created' }))).toEqual([])
    expect(triggerConfigIssues(FORM, list({ type: 'created' }, ['In Review']))).toEqual([])
  })

  it('takes any scope value where options also load per project, and lets an option word the summary', () => {
    expect(triggerEventLabel(triggerSummary(FORM, list({ type: 'entered' }, ['In Review'])))).toBe('On list · state In Review')
    expect(triggerEventLabel(triggerSummary(FORM, list({ type: 'entered' }, ['group:done'])))).toBe('On list · any "Done" state')
  })

  it('describes an optional scope apart from the event', () => {
    const summary = triggerSummary(FORM, list({ type: 'created' }, ['In Review', 'group:done']))
    expect(segmentsText(summary.event)).toBe('list created')
    expect(segmentsText(summary.scope!)).toBe('state In Review, any "Done" state')
    expect(triggerEventLabel(summary)).toBe('On list · list created · in state In Review, any "Done" state')
    expect(triggerSummary(FORM, list({ type: 'entered' }, ['In Review'])).scope).toBeUndefined()
  })

  it('names the field every issue belongs to', () => {
    expect(triggerConfigIssues(FORM, card({ type: 'labeled', values: [''] }, allOf({ board: ['dev'], size: ['s'], team: ['a'] })))).toEqual([
      { message: '"Label added" needs a value.', event: true },
      { message: 'Unknown condition "team"', condition: 2 },
    ])
    expect(triggerConfigIssues(FORM, list({ type: 'entered' }))).toEqual([{ message: '"State reached" needs a state.', scope: true }])
  })

  it('summarises kind, event and conditions, showing option labels', () => {
    const summary = triggerSummary(FORM, card({ type: 'moved', values: ['done'] }, allOf({ board: ['ops', 'dev'], size: ['s'] })))
    expect(summary.kind).toBe('Card')
    expect(summary.event).toEqual([{ kind: 'text', text: 'moved to ' }, { kind: 'value', text: 'Done' }])
    expect(summary.conditions.map(segmentsText)).toEqual(['board is ops, dev', 'size is S'])
    const negated = triggerSummary(FORM, card({ type: 'created' }, [...noneOf({ board: ['ops'] }), ...allOf({ size: ['s', 'l'] })])).conditions
    expect(negated.map(segmentsText)).toEqual(['board is not ops', 'size is S, L'])
    expect(negated[0]!.map(s => s.kind)).toEqual(['text', 'not', 'text', 'value'])
    expect(triggerEventLabel(triggerSummary([FORM[0]!], card({ type: 'labeled', values: ['go'] })))).toBe('On label go')
  })
})
