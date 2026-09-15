import { z } from 'zod'
import type { Trigger } from '../../db/schema'
import { INTEGRATIONS } from '../../integrations'

// A new source also needs a KTriggerForm<Source>.vue component wired into
// KTriggerCreateModal.vue and a TRIGGER_SOURCE_META entry in app/utils/dashboard.ts.

export type TriggerSource = 'schedule' | 'github' | 'manual' | 'jira'

export interface TriggerSourceDef {
  source: TriggerSource
  configSchema: z.ZodType<Record<string, unknown>>
  eventLabel(trigger: Trigger): string
  validateProjects?(projectIds: number[]): string | null
}

function relFuture(date: Date): string {
  const mins = Math.round((date.getTime() - Date.now()) / 60_000)
  if (mins <= 0) return 'now'
  if (mins < 60) return `in ${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

// The schedule keeps its own `cron` and `nextFireAt` columns: the scheduler queries them.
const schedule: TriggerSourceDef = {
  source: 'schedule',
  configSchema: z.object({}),
  eventLabel(t) {
    if (!t.active || !t.nextFireAt) return 'Paused'
    return `Next run ${relFuture(t.nextFireAt)}`
  },
}

const manual: TriggerSourceDef = {
  source: 'manual',
  configSchema: z.object({}),
  eventLabel: () => 'Run on demand',
}

export const TRIGGER_SOURCES: readonly TriggerSourceDef[] = [
  schedule,
  manual,
  ...INTEGRATIONS.map((i): TriggerSourceDef => ({
    source: i.id,
    configSchema: i.trigger.configSchema,
    eventLabel: t => i.trigger.eventLabel(t.config),
    validateProjects: i.trigger.validateProjects,
  })),
]

export function getTriggerSource(source: string): TriggerSourceDef | undefined {
  return TRIGGER_SOURCES.find(def => def.source === source)
}
