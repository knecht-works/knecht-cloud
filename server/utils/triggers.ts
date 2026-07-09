import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import type { IssueAction, Trigger } from '../db/schema'
import { isWorkflowEnabled } from '../workflows'
import { dispatchRuns } from '../daemon/dispatcher'
import { isGithubAppConfigured } from './github-credentials'
import { getTriggerSource } from './trigger-sources'

// Display + firing logic for triggers, shared by the API and the scheduler.

export type TriggerSource = 'schedule' | 'github' | 'manual' | 'jira'
export type TriggerKind = 'Cron' | 'Webhook' | 'Manual' | 'Jira'

// The shape the Triggers screen renders against (TriggerCard.vue). Project ids
// are resolved to short repo names; `endpoint` is the cron expression (schedule)
// or null (github/manual).
export interface TriggerSummary {
  id: number
  source: TriggerSource
  event: string
  kind: TriggerKind
  workflow: string
  projects: string[]
  projectIds: number[]
  endpoint: string | null
  webhookEvent: string | null
  webhookBranches: string[]
  issueActions: IssueAction[]
  issueLabel: string | null
  config: Record<string, unknown>
  active: boolean
  lastFiredAt: number | null
  firedCount: number
}

const KIND: Record<TriggerSource, TriggerKind> = {
  schedule: 'Cron',
  github: 'Webhook',
  manual: 'Manual',
  jira: 'Jira',
}

// Compact forward relative time ("in 3h", "in 2d") for the next scheduled run.
function relFuture(date: Date): string {
  const mins = Math.round((date.getTime() - Date.now()) / 60_000)
  if (mins <= 0) return 'now'
  if (mins < 60) return `in ${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

function eventLabel(t: Trigger): string {
  if (t.source === 'schedule') {
    if (!t.active || !t.nextFireAt) return 'Paused'
    return `Next run ${relFuture(t.nextFireAt)}`
  }
  if (t.source === 'github') return githubEventLabel(t)
  const def = getTriggerSource(t.source)
  if (def) return def.eventLabel(t.config)
  return 'Run on demand'
}

// "On push · main, staging" / "On pull_request · base main" / "On issues ·
// opened, label \"knecht\"". The filter part is omitted when it matches
// everything.
function githubEventLabel(t: Trigger): string {
  const event = t.webhookEvent ?? 'push'
  if (event === 'issues') {
    const parts = t.issueActions.map(a => (a === 'labeled' ? `label "${t.issueLabel ?? '?'}"` : a))
    return `On issues · ${parts.join(', ')}`
  }
  if (!t.webhookBranches.length) return `On ${event}`
  const prefix = event === 'pull_request' ? 'base ' : ''
  return `On ${event} · ${prefix}${t.webhookBranches.join(', ')}`
}

function endpoint(t: Trigger): string | null {
  return t.source === 'schedule' ? t.cron : null
}

// Map DB rows to the UI contract, resolving project ids to short repo names in
// one query.
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

  return rows.map(t => ({
    id: t.id,
    source: t.source,
    kind: KIND[t.source],
    event: eventLabel(t),
    workflow: t.workflow,
    projects: t.projectIds.map(id => names.get(id)).filter((n): n is string => !!n),
    projectIds: t.projectIds,
    endpoint: endpoint(t),
    webhookEvent: t.webhookEvent,
    webhookBranches: t.webhookBranches,
    issueActions: t.issueActions,
    issueLabel: t.issueLabel,
    config: t.config,
    active: t.active,
    lastFiredAt: t.lastFiredAt ? Math.floor(t.lastFiredAt.getTime() / 1000) : null,
    firedCount: t.firedCount,
  }))
}

// What a webhook delivery overrides on the runs it starts: the subset of the
// trigger's projects to fire (the delivery's repo), the branch to check out
// (push/PR branch instead of the default) and the event data for {{ inputs.* }}.
export interface FireOverrides {
  projectIds?: number[]
  branch?: string | null
  inputs?: Record<string, string>
}

// Queue the trigger's workflow against each of its projects (one run each; the
// dispatcher starts them as concurrency slots free up), then bump the fire
// counters. Returns the created run ids. Runs authenticate via the GitHub App
// (no session needed); with the app unconfigured each run is recorded as failed
// with a clear reason rather than failing silently.
export function fireTrigger(t: Trigger, opts: FireOverrides = {}): number[] {
  // The workflow's master switch is off → automation is paused. Don't create
  // runs or bump counters; the trigger stays configured and resumes when
  // re-enabled. Manual runs bypass this path entirely.
  if (!isWorkflowEnabled(t.workflow)) return []

  const projectIds = opts.projectIds ?? t.projectIds
  const projects = projectIds.length
    ? db.select().from(schema.projects).where(inArray(schema.projects.id, projectIds)).all()
    : []

  const runIds: number[] = []
  for (const project of projects) {
    const run = db
      .insert(schema.runs)
      .values({
        projectId: project.id,
        workflow: t.workflow,
        trigger: t.source,
        triggerId: t.id,
        branch: opts.branch ?? project.defaultBranch,
        inputs: opts.inputs ?? null,
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
