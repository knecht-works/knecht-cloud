import type { TriggerCondition } from '../../shared/utils/trigger-form'

export function allOf(fields: Record<string, string[]>): TriggerCondition[] {
  return Object.entries(fields).map(([field, values]): TriggerCondition => ({ field, op: 'is', values }))
}

export function noneOf(fields: Record<string, string[]>): TriggerCondition[] {
  return Object.entries(fields).map(([field, values]): TriggerCondition => ({ field, op: 'is-not', values }))
}
