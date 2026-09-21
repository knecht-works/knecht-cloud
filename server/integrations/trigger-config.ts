import { z } from 'zod'
import type { IntegrationId } from '../../shared/utils/integrations'
import { triggerConfigIssues, type TriggerConfig, type TriggerEventConfig, type TriggerEventDef, type TriggerFilterDef, type TriggerFormDef } from '../../shared/utils/trigger-form'

const shape = z.object({
  kind: z.string().min(1),
  on: z.array(z.object({ type: z.string().min(1), value: z.string().trim().optional() })),
  filters: z.record(z.string(), z.array(z.string().trim())).default({}),
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
    summary: 'label "{value}"',
    value: { input: 'select', placeholder: 'Pick a label', optionsUrl: `/api/integrations/${id}/options/labels` },
  }
}

export function labelFilter(id: IntegrationId): TriggerFilterDef {
  return { key: 'label', label: 'Has label', summary: 'with label {value}', input: 'list', placeholder: 'Pick labels or type a pattern like kn*', optionsUrl: `/api/integrations/${id}/options/labels` }
}

// Matched against `filterValues.priority`; a tool without priorities on an object reports `none`.
export function priorityFilter(): TriggerFilterDef {
  return { key: 'priority', label: 'Priority is', summary: '{value} priority', input: 'list', placeholder: 'Pick priorities', options: ['urgent', 'high', 'medium', 'low', 'none'].map(p => ({ label: p, value: p })) }
}

export function triggerEvent(config: TriggerConfig, type: string): TriggerEventConfig | undefined {
  return config.on.find(on => on.type === type)
}

export function passesList(config: TriggerConfig, key: string, test: (allowed: string[]) => boolean): boolean {
  const allowed = config.filters[key]
  return !allowed || test(allowed)
}

export function matchesAny(patterns: string[], values: string[]): boolean {
  const regexes = patterns.map(pattern => new RegExp(`^${pattern.split('*').map(RegExp.escape).join('.*')}$`))
  return regexes.some(regex => values.some(value => regex.test(value)))
}
