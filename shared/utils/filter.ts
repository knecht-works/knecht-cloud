import { matchesVersion } from './version'

export type FilterOp = 'is' | 'is not' | '=' | '<' | '>'

export interface FilterField {
  label: string
  ops: readonly FilterOp[]
  input?: 'version'
}

export type FilterFields = Record<string, FilterField>

export interface FilterCondition {
  field: string
  op: string
  value: string
}

export type FilterFacts = Record<string, string | string[] | null>

export function isCompleteCondition(c: FilterCondition): boolean {
  return c.value.trim() !== ''
}

function matches(fact: string | string[] | null, op: string, value: string): boolean {
  const values = fact === null ? [] : Array.isArray(fact) ? fact : [fact]
  switch (op) {
    case 'is': return values.includes(value)
    case 'is not': return !values.includes(value)
    case '=':
    case '<':
    case '>': return matchesVersion(values[0] ?? null, op, value)
    default: return true
  }
}

export function matchesFilters(facts: FilterFacts, conditions: FilterCondition[]): boolean {
  return conditions.filter(isCompleteCondition).every(c => c.field in facts && matches(facts[c.field]!, c.op, c.value))
}

export function serializeFilters(conditions: FilterCondition[]): string[] {
  return conditions.filter(isCompleteCondition).map(c => `${c.field}:${c.op}:${c.value}`)
}

export function parseFilters(query: string | null | undefined | (string | null)[], fields: FilterFields): FilterCondition[] {
  const entries = Array.isArray(query) ? query : [query]
  return entries.flatMap((entry) => {
    const [field = '', op = '', ...rest] = (entry ?? '').split(':')
    const condition = { field, op, value: rest.join(':') }
    const ops: readonly string[] | undefined = fields[field]?.ops
    return ops?.includes(op) && isCompleteCondition(condition) ? [condition] : []
  })
}

export function uniqueOptions(values: string[]): { value: string, label: string }[] {
  return [...new Set(values)].sort().map(value => ({ value, label: value }))
}
