import { matchesVersion, type VersionOp } from './version'

export type FilterField = 'stack' | 'version' | 'state' | 'tracker'

export interface FilterCondition {
  field: FilterField
  op: string
  value: string
}

export interface ProjectFacts {
  stack: string
  version: string | null
  state: string
  trackers: string[]
}

export const FILTER_FIELD_LABEL: Record<FilterField, string> = {
  stack: 'Stack',
  version: 'Version',
  state: 'State',
  tracker: 'Linked tracker',
}

export const FILTER_OPS: Record<FilterField, string[]> = {
  stack: ['is', 'is not'],
  version: ['=', '<', '>'],
  state: ['is', 'is not'],
  tracker: ['is'],
}

export function isCompleteCondition(c: FilterCondition): boolean {
  return c.value.trim() !== ''
}

export function matchesFilters(project: ProjectFacts, conditions: FilterCondition[]): boolean {
  return conditions.filter(isCompleteCondition).every((c) => {
    switch (c.field) {
      case 'stack': return (project.stack === c.value) === (c.op === 'is')
      case 'state': return (project.state === c.value) === (c.op === 'is')
      case 'version': return matchesVersion(project.version, c.op as VersionOp, c.value)
      case 'tracker': return project.trackers.includes(c.value)
    }
  })
}

export function serializeFilters(conditions: FilterCondition[]): string[] {
  return conditions.filter(isCompleteCondition).map(c => `${c.field}:${c.op}:${c.value}`)
}

export function parseFilters(query: string | null | undefined | (string | null)[]): FilterCondition[] {
  const entries = Array.isArray(query) ? query : [query]
  return entries.flatMap((entry) => {
    const [field, op, ...rest] = (entry ?? '').split(':')
    const condition = { field: field as FilterField, op: op ?? '', value: rest.join(':') }
    return FILTER_OPS[condition.field]?.includes(condition.op) && isCompleteCondition(condition) ? [condition] : []
  })
}
