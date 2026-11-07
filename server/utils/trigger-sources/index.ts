import { z } from 'zod'
import type { Trigger } from '../../db/schema'
import type { TrackerId, TriggerSource } from '../../../shared/utils/integrations'
import { triggerEventLabel, triggerSummary, type TriggerConfig, type TriggerFormDef, type TriggerSegment } from '../../../shared/utils/trigger-form'
import { INTEGRATIONS, type Integration } from '../../integrations'
import { gitTriggerForm } from '../../integrations/git-trigger-form'
import { triggerConfigSchema } from '../../integrations/trigger-config'
import { projectLinks } from '../../stores/project-links'
import { getProject } from '../../stores/projects'

// `event` is the one-line label; `on`, `conditions` and `scope` are its parts, set off for display.
export interface TriggerSourceDescription {
  event: string
  kind: string
  on: TriggerSegment[]
  conditions: TriggerSegment[][]
  scope?: TriggerSegment[]
}

export interface TriggerSourceDef {
  source: TriggerSource
  integration: TrackerId | null
  configSchema: z.ZodType<Record<string, unknown>>
  describe(trigger: Trigger): TriggerSourceDescription
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
  integration: null,
  configSchema: z.object({}),
  describe(t) {
    const event = !t.active || !t.nextFireAt ? 'Paused' : `Next run ${relFuture(t.nextFireAt)}`
    return { kind: '', on: [{ kind: 'text', text: event }], conditions: [], event }
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

function formSource(source: TriggerSource, integration: TrackerId | null, form: TriggerFormDef): Omit<TriggerSourceDef, 'validateProjects'> {
  return {
    source,
    integration,
    configSchema: triggerConfigSchema(form),
    describe: (t) => {
      const { event, ...description } = triggerSummary(form, t.config as unknown as TriggerConfig)
      return { ...description, on: event, event: triggerEventLabel({ ...description, event }) }
    },
  }
}

const git: TriggerSourceDef = {
  ...formSource('git', null, gitTriggerForm),
  validateProjects: ids => (ids.every(id => getProject(id)) ? null : 'Unknown project'),
}

export const TRIGGER_SOURCE_DEFS: readonly TriggerSourceDef[] = [
  schedule,
  git,
  ...INTEGRATIONS.flatMap((i): TriggerSourceDef[] => (i.trigger
    ? [{
        ...formSource('tracker', i.id as TrackerId, i.trigger.form),
        validateProjects: ids => validateLinkedProjects(i, ids),
      }]
    : [])),
]

export function getTriggerSource(source: string, integration: string | null = null): TriggerSourceDef | undefined {
  return TRIGGER_SOURCE_DEFS.find(def => def.source === source && def.integration === integration)
}
