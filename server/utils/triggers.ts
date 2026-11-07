import type { Trigger } from '../db/schema'
import { dispatchRuns } from '../daemon/dispatcher'
import { isGithubAppConfigured } from './github-credentials'
import { emptyInputs, type TriggerInputs } from './inputs'
import { resolveSession, type SessionObject } from './sessions'
import type { IntegrationId, TrackerId, TriggerSource } from '../../shared/utils/integrations'
import type { TriggerSegment } from '../../shared/utils/trigger-form'
import { getTriggerSource } from './trigger-sources'
import { getWorkflowRow, getWorkflowRows } from '../stores/workflows'
import { getProjects } from '../stores/projects'
import { recordTriggerFired } from '../stores/triggers'
import { appendRunLog, createRun, finishRun, workflowRanOnVersion } from '../stores/runs'

export interface TriggerSummary {
  id: number
  source: TriggerSource
  integration: TrackerId | null
  // The tool the trigger listens to: the tracker, or the git provider of its projects.
  via: IntegrationId | null
  event: string
  kind: string
  events: TriggerSegment[][]
  conditions: TriggerSegment[][][]
  workflowId: number
  workflowName: string
  projects: string[]
  projectIds: number[]
  endpoint: string | null
  config: Record<string, unknown>
  active: boolean
  lastFiredAt: number | null
  firedCount: number
}

function endpoint(t: Trigger): string | null {
  return t.source === 'schedule' ? t.cron : null
}

export function toSummaries(rows: Trigger[]): TriggerSummary[] {
  const projects = new Map(getProjects([...new Set(rows.flatMap(r => r.projectIds))]).map(p => [p.id, p]))
  const workflowNames = new Map(getWorkflowRows([...new Set(rows.map(r => r.workflowId))]).map(w => [w.id, w.name]))

  return rows.map(t => ({
    id: t.id,
    source: t.source,
    integration: t.integration,
    via: t.integration ?? (t.source === 'git' ? projects.get(t.projectIds[0]!)?.repoProvider ?? 'github' : null),
    ...(getTriggerSource(t.source, t.integration)?.describe(t) ?? { event: '', kind: '', events: [], conditions: [] }),
    workflowId: t.workflowId,
    workflowName: workflowNames.get(t.workflowId) ?? '',
    projects: t.projectIds.map(id => projects.get(id)?.name).filter((n): n is string => !!n),
    projectIds: t.projectIds,
    endpoint: endpoint(t),
    config: t.config,
    active: t.active,
    lastFiredAt: t.lastFiredAt ? Math.floor(t.lastFiredAt.getTime() / 1000) : null,
    firedCount: t.firedCount,
  }))
}

export interface FireOverrides {
  // The integration that delivered the event; recorded as the run's trigger.
  integration?: IntegrationId
  projectIds?: number[]
  branch?: string | null
  inputs?: TriggerInputs
  object?: SessionObject | null
  version?: string | null
  actor?: { id: string, name: string } | null
}

export function fireTrigger(t: Trigger, opts: FireOverrides = {}): number[] {
  const workflow = getWorkflowRow(t.workflowId)
  if (!workflow || !workflow.enabled || !workflow.publishedAt) return []

  const projectIds = opts.projectIds ?? t.projectIds
  const projects = getProjects(projectIds)

  const runIds: number[] = []
  for (const project of projects) {
    const session = resolveSession(project, opts.object ?? null, opts.branch ?? null)
    // One action reaches us as several deliveries of the same object version (see `objectVersion`),
    // and several triggers of one workflow can match the same version.
    if (opts.version && workflowRanOnVersion(workflow.id, session.id, opts.version)) continue
    const run = createRun({
      projectId: project.id,
      sessionId: session.id,
      workflow: workflow.name,
      workflowId: workflow.id,
      trigger: opts.integration ?? t.source,
      triggerId: t.id,
      branch: session.branch ?? opts.branch ?? project.defaultBranch,
      objectVersion: opts.version ?? null,
      actor: opts.actor ?? null,
      inputs: opts.inputs ?? emptyInputs(t.source),
    })
    runIds.push(run.id)

    if (!isGithubAppConfigured()) {
      appendRunLog(run.id, 'GitHub App not configured. Complete the GitHub App setup (/setup) to enable runs.\n')
      finishRun(run.id, 'failed')
    }
  }

  if (!runIds.length) return []

  recordTriggerFired(t)

  dispatchRuns()

  return runIds
}
