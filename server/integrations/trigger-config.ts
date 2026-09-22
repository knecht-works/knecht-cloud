import { z } from 'zod'
import type { IntegrationId } from '../../shared/utils/integrations'
import { TRIGGER_CONDITION_OPS, triggerConfigIssues, type TriggerConfig, type TriggerEventConfig, type TriggerEventDef, type TriggerFilterDef, type TriggerFormDef } from '../../shared/utils/trigger-form'

const shape = z.object({
  kind: z.string().min(1),
  on: z.array(z.object({ type: z.string().min(1), values: z.array(z.string().trim()).optional() })),
  conditions: z.array(z.array(z.object({ field: z.string().min(1), op: z.enum(TRIGGER_CONDITION_OPS), values: z.array(z.string().trim()) }))).default([]),
})

export function triggerConfigSchema(form: TriggerFormDef): z.ZodType<Record<string, unknown>> {
  return shape.superRefine((config, ctx) => {
    for (const issue of triggerConfigIssues(form, config)) ctx.addIssue({ code: 'custom', message: issue.message })
  })
}

// Picked from the tool's existing labels (`trigger.options.labels`): a typo would never fire.
export function labeledEvent(id: IntegrationId): TriggerEventDef {
  return {
    type: 'labeled',
    label: 'Label added',
    summary: 'label {value}',
    value: { placeholder: 'Pick a label', optionsUrl: `/api/integrations/${id}/options/labels`, listedOnly: true },
  }
}

export function labelFilter(id: IntegrationId): TriggerFilterDef {
  return { key: 'label', label: 'Label', listedOnly: true, placeholder: 'Pick labels', optionsUrl: `/api/integrations/${id}/options/labels` }
}

// A tool without priorities on an object reports `none`.
export function priorityFilter(): TriggerFilterDef {
  return { key: 'priority', label: 'Priority', listedOnly: true, placeholder: 'Pick priorities', options: ['urgent', 'high', 'medium', 'low', 'none'].map(p => ({ label: p, value: p })) }
}

export function triggerEvent(config: TriggerConfig, type: string): TriggerEventConfig | undefined {
  return config.on.find(on => on.type === type)
}

// `fields` holds the object's current values per filter key; a field it lacks has no values.
// `exact` names the `listedOnly` filters, whose values are no patterns.
export function conditionsPass(config: TriggerConfig, fields: Record<string, string[]>, exact: string[] = []): boolean {
  if (!config.conditions.length) return true
  return config.conditions.some(group => group.every((condition) => {
    const values = fields[condition.field] ?? []
    const hit = exact.includes(condition.field) ? condition.values.some(v => values.includes(v)) : matchesAny(condition.values, values)
    return condition.op === 'is' ? hit : !hit
  }))
}

export function listedOnlyKeys(filters: TriggerFilterDef[]): string[] {
  return filters.filter(f => f.listedOnly).map(f => f.key)
}

// Tools report one action as several deliveries (GitHub sends opened, labeled and assigned for
// an issue created with both), all carrying the object with the same update time. A trigger runs
// once per version, and one second is coarse enough to take GitHub's whole-second timestamps.
export function objectVersion(updatedAt: string | null | undefined): string | null {
  const ms = updatedAt ? Date.parse(updatedAt) : Number.NaN
  return Number.isNaN(ms) ? null : String(Math.floor(ms / 1000))
}

export function matchesAny(patterns: string[], values: string[]): boolean {
  const regexes = patterns.map(pattern => new RegExp(`^${pattern.split('*').map(RegExp.escape).join('.*')}$`))
  return regexes.some(regex => values.some(value => regex.test(value)))
}
