import { describe, expect, it } from 'vitest'
import { defaultTriggerConfig, triggerConfigIssues, triggerSummary, type TriggerFormDef } from '../../shared/utils/trigger-form'

const FORM: TriggerFormDef = [
  {
    kind: 'card',
    label: 'Card',
    events: [
      { type: 'created', label: 'Created', summary: 'created', default: true },
      { type: 'labeled', label: 'Label added', summary: 'label "{value}"', value: { input: 'text', default: 'go' }, default: true },
      { type: 'moved', label: 'Moved to', summary: 'moved to {value}', value: { input: 'select', options: [{ label: 'Doing', value: 'doing' }, { label: 'Done', value: 'done' }] } },
    ],
    filters: [
      { key: 'board', label: 'Board is', summary: 'board {value}', input: 'list' },
      { key: 'archived', label: 'Archive state is', summary: '{value}', input: 'select', options: [{ label: 'Active', value: 'no', summary: 'not archived' }, { label: 'Archived', value: 'yes' }] },
    ],
  },
  {
    kind: 'list',
    label: 'List',
    events: [{
      type: 'state',
      label: 'State reached',
      summary: 'state "{value}"',
      value: { input: 'select', options: [{ label: 'Done', value: 'group:done', summary: 'any "Done" state' }], optionsUrl: '/api/states' },
    }],
    filters: [],
  },
  { kind: 'board', label: 'Board', events: [{ type: 'created', label: 'Created', summary: 'created' }], filters: [] },
]

describe('trigger form', () => {
  it('starts a new trigger from the events marked as default', () => {
    expect(defaultTriggerConfig(FORM)).toEqual({ kind: 'card', on: [{ type: 'created' }, { type: 'labeled', value: 'go' }], filters: {} })
    expect(defaultTriggerConfig(FORM, 'board')).toEqual({ kind: 'board', on: [], filters: {} })
  })

  it('accepts a config made of declared events and filters', () => {
    expect(triggerConfigIssues(FORM, defaultTriggerConfig(FORM))).toEqual([])
    expect(triggerConfigIssues(FORM, { kind: 'card', on: [{ type: 'moved', value: 'done' }], filters: { board: ['ops'], archived: ['no'] } })).toEqual([])
  })

  it.each([
    [{ kind: 'lane', on: [{ type: 'created' }], filters: {} }, 'Unknown trigger kind "lane"'],
    [{ kind: 'card', on: [], filters: {} }, 'Pick at least one event.'],
    [{ kind: 'board', on: [{ type: 'labeled', value: 'go' }], filters: {} }, 'Unknown event "labeled"'],
    [{ kind: 'card', on: [{ type: 'created' }, { type: 'created' }], filters: {} }, '"Created" is listed twice'],
    [{ kind: 'card', on: [{ type: 'created', value: 'x' }], filters: {} }, '"Created" takes no value'],
    [{ kind: 'card', on: [{ type: 'labeled', value: ' ' }], filters: {} }, '"Label added" needs a value.'],
    [{ kind: 'card', on: [{ type: 'moved', value: 'gone' }], filters: {} }, '"gone" is not an option of "Moved to"'],
    [{ kind: 'card', on: [{ type: 'created' }], filters: { team: ['a'] } }, 'Unknown filter "team"'],
    [{ kind: 'card', on: [{ type: 'created' }], filters: { board: ['ops', ''] } }, 'Fill in or remove the "Board is" filter.'],
    [{ kind: 'card', on: [{ type: 'created' }], filters: { archived: ['maybe'] } }, 'Pick an option for "Archive state is".'],
    [{ kind: 'card', on: [{ type: 'created' }], filters: { archived: ['no', 'yes'] } }, 'Pick an option for "Archive state is".'],
  ])('rejects %o', (config, message) => {
    expect(triggerConfigIssues(FORM, config)[0]?.message).toBe(message)
  })

  it('takes any value where options also load per project, and lets an option word the summary', () => {
    expect(triggerConfigIssues(FORM, { kind: 'list', on: [{ type: 'state', value: 'In Review' }], filters: {} })).toEqual([])
    expect(triggerSummary(FORM, { kind: 'list', on: [{ type: 'state', value: 'In Review' }], filters: {} })).toBe('On list · state "In Review"')
    expect(triggerSummary(FORM, { kind: 'list', on: [{ type: 'state', value: 'group:done' }], filters: {} })).toBe('On list · any "Done" state')
  })

  it('names the event or filter every issue belongs to', () => {
    expect(triggerConfigIssues(FORM, { kind: 'card', on: [{ type: 'labeled', value: '' }, { type: 'moved' }], filters: { board: [] } })).toEqual([
      { message: '"Label added" needs a value.', event: 'labeled' },
      { message: '"Moved to" needs a value.', event: 'moved' },
      { message: 'Fill in or remove the "Board is" filter.', filter: 'board' },
    ])
    expect(triggerConfigIssues(FORM, { kind: 'card', on: [], filters: {} })).toEqual([{ message: 'Pick at least one event.' }])
  })

  it('summarises kind, events and filters, showing option labels', () => {
    expect(triggerSummary(FORM, { kind: 'card', on: [{ type: 'created' }, { type: 'moved', value: 'done' }], filters: { board: ['ops', 'dev'], archived: ['no'] } }))
      .toBe('On card · created, moved to Done · board ops, dev · not archived')
    expect(triggerSummary([FORM[0]!], { kind: 'card', on: [{ type: 'labeled', value: 'go' }], filters: {} })).toBe('On label "go"')
  })
})
