import { z } from 'zod'
import { triggerConfigIssues, type TriggerConfig, type TriggerEventConfig, type TriggerFormDef } from '../../shared/utils/trigger-form'

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

export function triggerEvent(config: TriggerConfig, type: string): TriggerEventConfig | undefined {
  return config.on.find(on => on.type === type)
}

export function passesList(config: TriggerConfig, key: string, test: (allowed: string[]) => boolean): boolean {
  const allowed = config.filters[key]
  return !allowed || test(allowed)
}
