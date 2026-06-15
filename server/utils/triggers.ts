import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Trigger } from '../db/schema'
import { startRun } from '../daemon/runner'
import { getServiceToken } from './credentials'

// Display + firing logic for triggers, shared by the API and the scheduler.

export type TriggerSource = 'schedule' | 'github' | 'manual'
export type TriggerKind = 'Cron' | 'Webhook' | 'Manual'

// The shape the Triggers screen renders against (TriggerCard.vue). Project ids
// are resolved to short repo names; `endpoint` is the cron expression (schedule),
// the webhook URL (github) or null (manual).
export interface TriggerSummary {
  id: number
  source: TriggerSource
  event: string
  kind: TriggerKind
  workflow: string
  projects: string[]
  endpoint: string | null
  active: boolean
  lastFiredAt: number | null
  firedCount: number
}

const KIND: Record<TriggerSource, TriggerKind> = {
  schedule: 'Cron',
  github: 'Webhook',
  manual: 'Manual',
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

function baseUrl(): string {
  const domain = process.env.KNECHT_BASE_DOMAIN
  return domain ? `https://${domain}` : ''
}

function eventLabel(t: Trigger): string {
  if (t.source === 'schedule') {
    if (!t.active || !t.nextFireAt) return 'Paused'
    return `Next run ${relFuture(t.nextFireAt)}`
  }
  if (t.source === 'github') return `On ${t.webhookEvent ?? 'push'}`
  return 'Run on demand'
}

function endpoint(t: Trigger): string | null {
  if (t.source === 'schedule') return t.cron
  if (t.source === 'github') return `${baseUrl()}/api/triggers/${t.id}/webhook`
  return null
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
    endpoint: endpoint(t),
    active: t.active,
    lastFiredAt: t.lastFiredAt ? Math.floor(t.lastFiredAt.getTime() / 1000) : null,
    firedCount: t.firedCount,
  }))
}

// Start the trigger's workflow against each of its projects (one run each), then
// bump the fire counters. Returns the created run ids. With no remembered token
// (nobody has logged in) each run is recorded as failed with a clear reason
// rather than failing silently — the scheduler runs with no session.
export function fireTrigger(t: Trigger): number[] {
  const token = getServiceToken()
  const projects = t.projectIds.length
    ? db.select().from(schema.projects).where(inArray(schema.projects.id, t.projectIds)).all()
    : []

  const runIds: number[] = []
  for (const project of projects) {
    const run = db
      .insert(schema.runs)
      .values({ projectId: project.id, workflow: t.workflow })
      .returning()
      .get()
    runIds.push(run.id)

    if (token) {
      startRun(run.id, project, token)
    }
    else {
      db.update(schema.runs)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          log: 'No stored GitHub credentials — log in to Knecht once to enable background trigger runs.\n',
        })
        .where(eq(schema.runs.id, run.id))
        .run()
    }
  }

  db.update(schema.triggers)
    .set({ lastFiredAt: new Date(), firedCount: t.firedCount + 1, updatedAt: new Date() })
    .where(eq(schema.triggers.id, t.id))
    .run()

  return runIds
}
