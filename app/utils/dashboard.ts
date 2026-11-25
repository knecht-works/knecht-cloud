import type { Step } from '#shared/utils/workflow'
import type { EnvState, EnvTransition, RunDiagnosis } from '#shared/utils/run'
import { INTEGRATION_IDS, type IntegrationId, type ObjectKind } from '#shared/utils/integrations'
import { FRAMEWORKS } from '#shared/utils/frameworks'
import { INTEGRATION_UI, integrationUi, type SessionObjectMeta } from '~/utils/integrations'

export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

type DotColor = 'primary' | 'orange' | 'neutral' | 'error'

export const DOT_COLOR_VAR = {
  primary: 'var(--primary)',
  success: 'var(--primary)',
  orange: 'var(--accent-orange)',
  violet: 'var(--accent-violet)',
  warning: 'var(--accent-violet)',
  error: 'var(--status-error)',
  neutral: 'var(--status-neutral)',
}

export interface RunStatusMeta {
  dot: DotColor
  pulse: boolean
  text: string
  label: string
}

export const RUN_STATUS_META: Record<RunStatus, RunStatusMeta> = {
  success: { dot: 'primary', pulse: false, text: 'var(--text-primary)', label: 'Succeeded' },
  running: { dot: 'orange', pulse: true, text: 'var(--accent-orange)', label: 'Running' },
  queued: { dot: 'neutral', pulse: false, text: 'var(--text-dimmed)', label: 'Queued' },
  failed: { dot: 'error', pulse: false, text: 'var(--status-error)', label: 'Failed' },
  cancelled: { dot: 'neutral', pulse: false, text: 'var(--text-dimmed)', label: 'Cancelled' },
}

export function isLiveStatus(status: RunStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running'
}

export const IDLE_STATUS_META: RunStatusMeta = {
  dot: 'neutral',
  pulse: false,
  text: 'var(--text-dimmed)',
  label: 'No runs yet',
}

const ENV_LABEL: Partial<Record<EnvState, string>> = { stopped: 'Stopped', archived: 'Archived' }

const TRANSITION_LABEL: Record<EnvTransition, string> = {
  booting: 'Booting',
  stopping: 'Stopping',
  rebooting: 'Rebooting',
  restoring: 'Restoring',
  archiving: 'Archiving',
  expiring: 'Expiring',
}

// A success only stays green while its environment is up to inspect.
export function runStatusMeta(run: { status: RunStatus, envState: EnvState, envTransition?: EnvTransition | null } | null | undefined): RunStatusMeta {
  if (!run) return IDLE_STATUS_META
  const meta = RUN_STATUS_META[run.status]
  if (run.envTransition && !isLiveStatus(run.status)) {
    return { dot: 'orange', pulse: true, text: 'var(--accent-orange)', label: TRANSITION_LABEL[run.envTransition] }
  }
  if (run.status !== 'success' || run.envState === 'up') return meta
  return { dot: 'neutral', pulse: false, text: 'var(--text-dimmed)', label: ENV_LABEL[run.envState] ?? meta.label }
}

const WORKFLOW_STATUS_META: Partial<Record<RunStatus, RunStatusMeta>> = {
  success: RUN_STATUS_META.success,
  failed: RUN_STATUS_META.failed,
  cancelled: { ...RUN_STATUS_META.cancelled, text: 'var(--text-muted)', label: 'Stopped' },
}

// Only finished runs count, so a workflow shows how it ended last, not what is in flight.
export function workflowStatusMeta(runs: { status: RunStatus }[]): RunStatusMeta | null {
  for (const r of runs) {
    const meta = WORKFLOW_STATUS_META[r.status]
    if (meta) return meta
  }
  return null
}

const SESSION_ENV_META: Record<EnvState, RunStatusMeta> = {
  up: { dot: 'primary', pulse: false, text: 'var(--text-primary)', label: 'Up' },
  stopped: { dot: 'neutral', pulse: false, text: 'var(--text-muted)', label: 'Stopped' },
  archived: { dot: 'neutral', pulse: false, text: 'var(--text-muted)', label: 'Archived' },
  down: { dot: 'neutral', pulse: false, text: 'var(--text-muted)', label: 'Idle' },
}

export interface ProjectRunSummary {
  status: RunStatus
  envState: EnvState
  previewReady: boolean
  envTransition?: EnvTransition | null
  sessionStatus: 'open' | 'closed'
  workflow: string
  createdAt: string | number | Date | null
}

export interface SessionHeaderRun extends ProjectRunSummary {
  title: string | null
}

export interface ProjectActivity {
  open: number
  live: number
  prs: number
}

export function projectStatusMeta(run: Omit<ProjectRunSummary, 'workflow' | 'createdAt'> | null | undefined): RunStatusMeta {
  if (!run || run.envTransition || isLiveStatus(run.status) || run.status === 'failed') return runStatusMeta(run)
  if (run.envState === 'up' && run.previewReady) return { ...SESSION_ENV_META.up, label: 'Live' }
  if (run.envState === 'down' && run.sessionStatus === 'closed') return { ...SESSION_ENV_META.down, label: 'Closed' }
  return SESSION_ENV_META[run.envState]
}

interface TriggerSourceMeta {
  icon: string
  label: string
  color: string
}

const TRIGGER_SOURCE_META: Record<string, TriggerSourceMeta> = {
  manual: { icon: 'i-lucide-mouse-pointer-click', label: 'Manual', color: 'var(--text-primary)' },
  schedule: { icon: 'i-lucide-clock', label: 'Schedule', color: 'var(--accent-orange)' },
  git: { icon: 'i-lucide-git-branch', label: 'Git', color: 'var(--text-toned)' },
  tracker: { icon: 'i-lucide-ticket', label: 'Issue tracker', color: 'var(--accent-violet)' },
  mention: { icon: 'i-lucide-at-sign', label: 'Mention', color: 'var(--accent-violet)' },
  ...Object.fromEntries(INTEGRATION_IDS.map((id) => {
    const { icon, label, color } = INTEGRATION_UI[id]
    return [id, { icon, label, color }]
  })),
}

export function triggerSourceMeta(source: string): TriggerSourceMeta {
  return TRIGGER_SOURCE_META[source] ?? { icon: 'i-lucide-zap', label: source, color: 'var(--accent-violet)' }
}

export function triggerMeta(trigger: { source: string, via: string | null }): TriggerSourceMeta {
  return triggerSourceMeta(trigger.via ?? trigger.source)
}

export function workflowTriggerMetas(triggers: { source: string, via: string | null }[]): TriggerSourceMeta[] {
  if (!triggers.length) return [triggerSourceMeta('manual')]
  return [...new Map(triggers.map(triggerMeta).map(m => [m.label, m])).values()]
}

export function projectIntegrations(repoProvider: IntegrationId, links?: Partial<Record<IntegrationId, string>>) {
  return [repoProvider, ...Object.keys(links ?? {}) as IntegrationId[]].map(integrationUi)
}

export type SessionObjectKind = ObjectKind

const UNKNOWN_OBJECT: SessionObjectMeta = { icon: 'i-lucide-circle-dot', label: 'Object', color: 'var(--text-toned)', prefix: '' }

export function sessionObjectMeta(integration: IntegrationId, kind: SessionObjectKind): SessionObjectMeta {
  return INTEGRATION_UI[integration]?.objects[kind] ?? UNKNOWN_OBJECT
}

export interface SessionObject {
  integration: IntegrationId
  kind: SessionObjectKind
  key: string
  title: string | null
  url: string | null
  closed: boolean
}

interface SessionRunRow {
  sessionId: number
  objects: SessionObject[]
}

export interface SessionGroup<T> {
  sessionId: number
  objects: SessionObject[]
  runs: T[]
}

export function groupRunsBySession<T extends SessionRunRow>(runs: T[]): SessionGroup<T>[] {
  const bySession = new Map<number, T[]>()
  for (const r of runs) {
    const group = bySession.get(r.sessionId)
    if (group) group.push(r)
    else bySession.set(r.sessionId, [r])
  }
  return [...bySession.values()].map((groupRuns) => {
    const head = groupRuns[0]!
    return {
      sessionId: head.sessionId,
      objects: head.objects,
      runs: groupRuns,
    }
  })
}

// A later run of the session, such as a started preview, has no title of its own.
export function sessionTitle(g: SessionGroup<{ title: string | null, workflow: string }>): string {
  const o = g.objects[0]
  if (o) return o.title ?? `${sessionObjectMeta(o.integration, o.kind).prefix}${o.key}`
  return g.runs.find(r => r.title)?.title ?? g.runs[0]!.workflow
}

export function sessionTicket(g: SessionGroup<unknown>): SessionObject | undefined {
  return g.objects.find(o => o.kind !== 'pull_request')
}

export function sessionBranch(g: SessionGroup<{ branch: string | null }>): string | null {
  return g.runs.find(r => r.branch)?.branch ?? null
}

export function sessionPr(g: SessionGroup<{ prUrl: string | null }>): { label: string, url: string, closed: boolean } | null {
  const o = g.objects.find(o => o.kind === 'pull_request' && o.url)
  if (o) return { label: `PR ${sessionObjectMeta(o.integration, o.kind).prefix}${o.key}`, url: o.url!, closed: o.closed }
  const url = g.runs.find(r => r.prUrl)?.prUrl
  return url ? { label: 'PR', url, closed: false } : null
}

interface SessionStatusRun {
  status: RunStatus
  workflow: string
  envState: EnvState
  envTransition?: EnvTransition | null
  hasEnv: boolean
  hasPreviewTarget: boolean
  failureDiagnosis: RunDiagnosis | null
}

export function sessionStatusLine(r: SessionStatusRun | null | undefined): string {
  if (!r) return 'No runs yet. Start a workflow to boot this project.'
  if (r.status === 'running' || r.status === 'queued') return `Working on ${r.workflow} right now.`
  if (r.status === 'failed') {
    if (r.failureDiagnosis?.state === 'pending') return 'Knecht is looking into why the last run failed.'
    return r.failureDiagnosis?.summary ?? 'The last run failed. Open it to see why.'
  }
  if (!r.hasEnv) return 'This session has code only. Start a preview from the run menu to boot it.'
  if (r.envTransition === 'stopping') return 'The environment is shutting down.'
  if (r.envTransition === 'rebooting') return 'The environment is booting again. The preview is back in a moment.'
  if (r.envTransition === 'restoring') return 'The environment is being restored from its archive. This takes a few minutes.'
  if (r.envTransition === 'archiving') return 'The environment is being archived.'
  if (r.envState === 'up') return r.hasPreviewTarget ? 'The preview is live and ready to inspect.' : 'The environment is up. Open the terminal or the IDE to work in it.'
  if (r.envState === 'stopped') return 'The environment is stopped. Reboot it from the run menu or send a follow-up to wake it.'
  if (r.envState === 'archived') return 'The environment is archived. Restore it from the run menu to work in it again.'
  return 'The environment is gone. Run the workflow again for a fresh one.'
}

interface FrameworkMeta {
  label: string
  color: string
}

const UNKNOWN_FRAMEWORK: FrameworkMeta = { label: 'DDEV', color: 'var(--text-toned)' }

export function frameworkMeta(type?: string | null): FrameworkMeta {
  if (!type) return UNKNOWN_FRAMEWORK
  const t = type.toLowerCase()
  const fw = FRAMEWORKS.find(f => f.id === t || (f.id === 'drupal' && t.startsWith('drupal')))
  return { label: fw?.label ?? type.toUpperCase(), color: fw?.color ?? 'var(--text-toned)' }
}

// det = deterministic, out = output, flow = if/loop
export type StepKind = 'det' | 'ai' | 'out' | 'flow' | 'trigger'

export const STEP_KIND_COLOR: Record<StepKind, string> = {
  det: 'var(--text-toned)',
  ai: 'var(--accent-orange)',
  out: 'var(--primary)',
  flow: 'var(--accent-violet)',
  trigger: 'var(--accent-violet)',
}

export type WorkflowStep = Step

// H3 puts the status message of a failed `$fetch` into `error.data.statusMessage`.
export function errMsg(e: unknown, fallback: string): string {
  return (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? fallback
}

type TimeValue = Date | string | number | null | undefined

function toDate(value: TimeValue): Date | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function timeAgo(value: TimeValue): string {
  const date = toDate(value)
  if (!date) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function runDuration(start: TimeValue, end: TimeValue, now: number): string {
  const from = toDate(start)
  if (!from) return ''
  const to = toDate(end)?.getTime() ?? now
  return formatDuration((to - from.getTime()) / 1000)
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ${seconds % 60}s`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${String(mins % 60).padStart(2, '0')}m`
}
