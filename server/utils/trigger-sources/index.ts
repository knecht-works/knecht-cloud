import { z } from 'zod'
import type { Trigger } from '../../db/schema'
import type { TriggerSource } from '../../../shared/utils/integrations'
import { triggerSummary, type TriggerConfig } from '../../../shared/utils/trigger-form'
import { INTEGRATIONS, type Integration } from '../../integrations'
import { triggerConfigSchema } from '../../integrations/trigger-config'
import { getProject } from '../entities'
import { projectLinks } from '../project-links'

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

function validateLinkedProjects(integration: Integration, projectIds: number[]): string | null {
  const link = integration.link
  if (!link) return null
  if (projectIds.length === 0) return `A ${integration.name} trigger needs at least one project`
  for (const id of projectIds) {
    const project = getProject(id)
    if (!project) return 'Unknown project'
    if (!projectLinks(project.id)[integration.id]) return `Link ${project.fullName} to a ${link.label} first (project settings)`
  }
  return null
}

export const TRIGGER_SOURCE_DEFS: readonly TriggerSourceDef[] = [
  schedule,
  ...INTEGRATIONS.map((i): TriggerSourceDef => ({
    source: i.id,
    configSchema: triggerConfigSchema(i.trigger.form),
    eventLabel: t => triggerSummary(i.trigger.form, t.config as unknown as TriggerConfig),
    validateProjects: ids => validateLinkedProjects(i, ids),
  })),
]

export function getTriggerSource(source: string): TriggerSourceDef | undefined {
  return TRIGGER_SOURCE_DEFS.find(def => def.source === source)
}
