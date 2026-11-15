import { describe, expect, it } from 'vitest'
import { matchesFilters, parseFilters, serializeFilters, uniqueOptions, type FilterFacts, type FilterFields } from '../../shared/utils/filter'

const FIELDS: FilterFields = {
  stack: { label: 'Stack', ops: ['is', 'is not'] },
  version: { label: 'Version', ops: ['=', '<', '>'], input: 'version' },
  tracker: { label: 'Linked tracker', ops: ['is'] },
}

const craft: FilterFacts = { stack: 'Craft CMS', version: '5.4.2', tracker: ['jira'] }
const laravel: FilterFacts = { stack: 'Laravel', version: '11.2.0', tracker: [] }

describe('matchesFilters', () => {
  it('keeps everything without conditions', () => {
    expect(matchesFilters(craft, [])).toBe(true)
  })

  it('combines conditions with and', () => {
    const conditions = [
      { field: 'stack', op: 'is', value: 'Craft CMS' },
      { field: 'version', op: '<', value: '5.4.3' },
    ]
    expect(matchesFilters(craft, conditions)).toBe(true)
    expect(matchesFilters({ ...craft, version: '5.4.3' }, conditions)).toBe(false)
    expect(matchesFilters(laravel, conditions)).toBe(false)
  })

  it('negates with is not', () => {
    expect(matchesFilters(laravel, [{ field: 'stack', op: 'is not', value: 'Craft CMS' }])).toBe(true)
    expect(matchesFilters(craft, [{ field: 'stack', op: 'is not', value: 'Craft CMS' }])).toBe(false)
  })

  it('matches a value in a list', () => {
    expect(matchesFilters(craft, [{ field: 'tracker', op: 'is', value: 'jira' }])).toBe(true)
    expect(matchesFilters(laravel, [{ field: 'tracker', op: 'is', value: 'jira' }])).toBe(false)
    expect(matchesFilters(laravel, [{ field: 'tracker', op: 'is not', value: 'jira' }])).toBe(true)
  })

  it('never matches a version comparison without a version', () => {
    expect(matchesFilters({ ...craft, version: null }, [{ field: 'version', op: '<', value: '6' }])).toBe(false)
  })

  it('ignores a condition without a value', () => {
    expect(matchesFilters(laravel, [{ field: 'stack', op: 'is', value: '' }])).toBe(true)
  })
})

describe('filter query', () => {
  const conditions = [
    { field: 'stack', op: 'is not', value: 'Craft CMS' },
    { field: 'version', op: '<', value: '5.4.3' },
  ]

  it('round-trips complete conditions', () => {
    expect(parseFilters(serializeFilters(conditions), FIELDS)).toEqual(conditions)
  })

  it('leaves incomplete conditions out of the query', () => {
    expect(serializeFilters([...conditions, { field: 'tracker', op: 'is', value: '' }])).toEqual(['stack:is not:Craft CMS', 'version:<:5.4.3'])
  })

  it('accepts a single value and drops unknown fields or operators', () => {
    expect(parseFilters('tracker:is:jira', FIELDS)).toEqual([{ field: 'tracker', op: 'is', value: 'jira' }])
    expect(parseFilters(['owner:is:me', 'version:>=:5', 'stack:is:', null], FIELDS)).toEqual([])
    expect(parseFilters(undefined, FIELDS)).toEqual([])
  })
})

describe('uniqueOptions', () => {
  it('dedupes and sorts the values', () => {
    expect(uniqueOptions(['Laravel', 'Craft CMS', 'Laravel'])).toEqual([
      { value: 'Craft CMS', label: 'Craft CMS' },
      { value: 'Laravel', label: 'Laravel' },
    ])
  })
})
