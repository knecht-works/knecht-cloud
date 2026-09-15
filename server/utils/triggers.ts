import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Trigger } from '../db/schema'
import { dispatchRuns } from '../daemon/dispatcher'
import { getWorkflowRow } from './entities'
import { isGithubAppConfigured } from './github-credentials'
import { emptyInputs, type TriggerInputs } from './inputs'
import { resolveSession, type SessionObject } from './sessions'
import type { TriggerSource } from '../../shared/utils/integrations'
import { getTriggerSource } from './trigger-sources'

export interface TriggerSummary {
  id: number
  source: TriggerSource
  event: string
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
  const ids = [...new Set(rows.flatMap(r => r.projectIds))]
  const names = new Map<number, string>()
  if (ids.length) {
    for (const p of db
      .select({ id: schema.projects.id, name: schema.projects.name })
      .from(schema.projects)
      .where(inArray(schema.projects.id, ids))
      .all()) {
      names.set(p.id, p.name)
    }
  }

  const workflowIds = [...new Set(rows.map(r => r.workflowId))]
  const workflowNames = new Map<number, string>()
  if (workflowIds.length) {
    for (const w of db
      .select({ id: schema.workflows.id, name: schema.workflows.name })
      .from(schema.workflows)
      .where(inArray(schema.workflows.id, workflowIds))
      .all()) {
      workflowNames.set(w.id, w.name)
    }
  }

  return rows.map(t => ({
    id: t.id,
    source: t.source,
    event: getTriggerSource(t.source)?.eventLabel(t) ?? '',
    workflowId: t.workflowId,
    workflowName: workflowNames.get(t.workflowId) ?? '',
    projects: t.projectIds.map(id => names.get(id)).filter((n): n is string => !!n),
    projectIds: t.projectIds,
    endpoint: endpoint(t),
    config: t.config,
    active: t.active,
    lastFiredAt: t.lastFiredAt ? Math.floor(t.lastFiredAt.getTime() / 1000) : null,
    firedCount: t.firedCount,
  }))
}

export interface FireOverrides {
  projectIds?: number[]
  branch?: string | null
  inputs?: TriggerInputs
  object?: SessionObject | null
}

export function fireTrigger(t: Trigger, opts: FireOverrides = {}): number[] {
  const workflow = getWorkflowRow(t.workflowId)
  if (!workflow || !workflow.enabled || !workflow.publishedAt) return []

  const projectIds = opts.projectIds ?? t.projectIds
  const projects = projectIds.length
    ? db.select().from(schema.projects).where(inArray(schema.projects.id, projectIds)).all()
    : []

  const runIds: number[] = []
  for (const project of projects) {
    const session = resolveSession(project, opts.object ?? null, opts.branch ?? null)
    const run = db
      .insert(schema.runs)
      .values({
        projectId: project.id,
        sessionId: session.id,
        workflow: workflow.name,
        workflowId: workflow.id,
        trigger: t.source,
        triggerId: t.id,
        branch: session.branch ?? opts.branch ?? project.defaultBranch,
        inputs: opts.inputs ?? emptyInputs(t.source),
      })
      .returning()
      .get()
    runIds.push(run.id)

    if (!isGithubAppConfigured()) {
      db.update(schema.runs)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          log: 'GitHub App not configured. Complete the GitHub App setup (/setup) to enable runs.\n',
        })
        .where(eq(schema.runs.id, run.id))
        .run()
    }
  }

  db.update(schema.triggers)
    .set({ lastFiredAt: new Date(), firedCount: t.firedCount + 1, updatedAt: new Date() })
    .where(eq(schema.triggers.id, t.id))
    .run()

  dispatchRuns()

  return runIds
}
