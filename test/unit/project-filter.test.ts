import { describe, expect, it } from 'vitest'
import { matchesFilters, parseFilters, serializeFilters, type ProjectFacts } from '../../shared/utils/project-filter'

const craft: ProjectFacts = { stack: 'Craft CMS', version: '5.4.2', state: 'Live', trackers: ['jira'] }
const laravel: ProjectFacts = { stack: 'Laravel', version: '11.2.0', state: 'Failed', trackers: [] }

describe('matchesFilters', () => {
  it('keeps every project without conditions', () => {
    expect(matchesFilters(craft, [])).toBe(true)
  })

  it('combines conditions with and', () => {
    const conditions = [
      { field: 'stack' as const, op: 'is', value: 'Craft CMS' },
      { field: 'version' as const, op: '<', value: '5.4.3' },
    ]
    expect(matchesFilters(craft, conditions)).toBe(true)
    expect(matchesFilters({ ...craft, version: '5.4.3' }, conditions)).toBe(false)
    expect(matchesFilters(laravel, conditions)).toBe(false)
  })

  it('negates stack and state with is not', () => {
    expect(matchesFilters(laravel, [{ field: 'stack', op: 'is not', value: 'Craft CMS' }])).toBe(true)
    expect(matchesFilters(craft, [{ field: 'state', op: 'is not', value: 'Live' }])).toBe(false)
  })

  it('matches a linked tracker', () => {
    expect(matchesFilters(craft, [{ field: 'tracker', op: 'is', value: 'jira' }])).toBe(true)
    expect(matchesFilters(laravel, [{ field: 'tracker', op: 'is', value: 'jira' }])).toBe(false)
  })

  it('ignores a condition without a value', () => {
    expect(matchesFilters(laravel, [{ field: 'stack', op: 'is', value: '' }])).toBe(true)
  })
})

describe('filter query', () => {
  const conditions = [
    { field: 'stack' as const, op: 'is not', value: 'Craft CMS' },
    { field: 'version' as const, op: '<', value: '5.4.3' },
  ]

  it('round-trips complete conditions', () => {
    expect(parseFilters(serializeFilters(conditions))).toEqual(conditions)
  })

  it('leaves incomplete conditions out of the query', () => {
    expect(serializeFilters([...conditions, { field: 'state', op: 'is', value: '' }])).toEqual(['stack:is not:Craft CMS', 'version:<:5.4.3'])
  })

  it('accepts a single value and drops unknown fields or operators', () => {
    expect(parseFilters('tracker:is:jira')).toEqual([{ field: 'tracker', op: 'is', value: 'jira' }])
    expect(parseFilters(['owner:is:me', 'version:>=:5', 'stack:is:', null])).toEqual([])
    expect(parseFilters(undefined)).toEqual([])
  })
})
