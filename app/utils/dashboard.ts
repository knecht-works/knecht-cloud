import type { Step } from '#shared/utils/workflow'

// Shared display helpers for the dashboard screens: keeps status mapping and
// formatting in one place so the screens stay free of ad-hoc logic.

export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

type DotColor = 'primary' | 'orange' | 'neutral' | 'error'

export interface RunStatusMeta {
  dot: DotColor
  /** true while the run is still live (drives the pulse + progress framing) */
  pulse: boolean
  /** CSS colour for the status text */
  text: string
  /** short human label */
  label: string
}

// Maps a run's lifecycle status to the design's dot + text treatment.
export const RUN_STATUS_META: Record<RunStatus, RunStatusMeta> = {
  success: { dot: 'primary', pulse: false, text: 'var(--text-primary)', label: 'Succeeded' },
  running: { dot: 'orange', pulse: true, text: 'var(--accent-orange)', label: 'Running' },
  queued: { dot: 'neutral', pulse: false, text: 'var(--text-dimmed)', label: 'Queued' },
  failed: { dot: 'error', pulse: false, text: 'var(--status-error)', label: 'Failed' },
  cancelled: { dot: 'neutral', pulse: false, text: 'var(--text-dimmed)', label: 'Cancelled' },
}

// True while the run still occupies the runner (drives polling + live UI).
export function isLiveStatus(status: RunStatus | null | undefined): boolean {
  return status === 'queued' || status === 'running'
}

// "Ready / no runs yet" state for a project that has never been run.
export const IDLE_STATUS_META: RunStatusMeta = {
  dot: 'neutral',
  pulse: false,
  text: 'var(--text-dimmed)',
  label: 'No runs yet',
}

// Trigger-source presentation, shared by every place a trigger (or the trigger
// that fired a run) shows up: run meta, project panel, editor head.
interface TriggerSourceMeta {
  icon: string
  label: string
  color: string
}

const TRIGGER_SOURCE_META: Record<string, TriggerSourceMeta> = {
  manual: { icon: 'i-lucide-mouse-pointer-click', label: 'Manual', color: 'var(--text-primary)' },
  schedule: { icon: 'i-lucide-clock', label: 'Schedule', color: 'var(--accent-orange)' },
  github: { icon: 'i-simple-icons-github', label: 'GitHub', color: 'var(--text-toned)' },
  jira: { icon: 'i-simple-icons-jira', label: 'Jira', color: '#579dff' },
  mention: { icon: 'i-lucide-at-sign', label: 'Mention', color: 'var(--accent-violet)' },
}

// Unknown sources (added later) render generically instead of breaking.
export function triggerSourceMeta(source: string): TriggerSourceMeta {
  return TRIGGER_SOURCE_META[source] ?? { icon: 'i-lucide-zap', label: source, color: 'var(--accent-violet)' }
}

// Session-object presentation: the issue or PR a session works on. Drives the
// session groups in the run lists and the run header's object chip. A closed
// object switches to its closed icon (GitHub's pattern) instead of a text
// label.
export type SessionObjectKind = 'issue' | 'pull_request'

interface SessionObjectMeta {
  icon: string
  closedIcon: string
  label: string
  color: string
}

const SESSION_OBJECT_META: Record<SessionObjectKind, SessionObjectMeta> = {
  issue: { icon: 'i-lucide-circle-dot', closedIcon: 'i-lucide-circle-check', label: 'Issue', color: 'var(--text-primary)' },
  pull_request: { icon: 'i-lucide-git-pull-request', closedIcon: 'i-lucide-git-pull-request-closed', label: 'PR', color: 'var(--accent-violet)' },
}

export function sessionObjectMeta(kind: SessionObjectKind): SessionObjectMeta {
  return SESSION_OBJECT_META[kind]
}

// Runs grouped by session for the run lists: runs on the same issue/PR
// collect under one object header, one-shot runs (no object) stay plain
// rows. Sessions are ordered by their newest run (the list arrives newest
// first and Map preserves first-seen order); WITHIN a session the runs are
// flipped to chronological order, so a session reads top-down like the story
// of the work.
interface SessionRunRow {
  sessionId: number
  objectKind: SessionObjectKind | null
  objectNumber: number | null
  objectTitle: string | null
  objectUrl: string | null
  sessionStatus: 'open' | 'closed'
  envState: 'down' | 'up' | 'stopped' | 'archived'
}

export function groupRunsBySession<T extends SessionRunRow>(runs: T[]) {
  const bySession = new Map<number, T[]>()
  for (const r of runs) {
    const group = bySession.get(r.sessionId)
    if (group) group.push(r)
    else bySession.set(r.sessionId, [r])
  }
  return [...bySession.values()].map((groupRuns) => {
    const head = groupRuns[0]!
    groupRuns.reverse()
    return {
      sessionId: head.sessionId,
      object: head.objectKind
        ? {
            kind: head.objectKind,
            number: head.objectNumber,
            title: head.objectTitle,
            url: head.objectUrl,
            closed: head.sessionStatus === 'closed',
            live: head.envState === 'up',
          }
        : null,
      runs: groupRuns,
    }
  })
}

// Framework presentation, keyed by the DDEV project `type` read from the repo's
// `.ddev/config.yaml`. Drives the label + accent colour across the dashboard.
interface FrameworkMeta {
  label: string
  color: string
}

const FRAMEWORKS: Record<string, FrameworkMeta> = {
  typo3: { label: 'TYPO3', color: 'var(--accent-orange)' },
  wordpress: { label: 'WordPress', color: 'var(--accent-violet)' },
  craftcms: { label: 'Craft CMS', color: '#7aa8d8' },
  shopware6: { label: 'Shopware', color: 'var(--primary)' },
  laravel: { label: 'Laravel', color: 'var(--accent-clay)' },
  magento: { label: 'Magento', color: 'var(--accent-orange)' },
  magento2: { label: 'Magento', color: 'var(--accent-orange)' },
  silverstripe: { label: 'SilverStripe', color: '#7aa8d8' },
  backdrop: { label: 'Backdrop', color: '#7aa8d8' },
  php: { label: 'PHP', color: 'var(--text-toned)' },
}

const UNKNOWN_FRAMEWORK: FrameworkMeta = { label: 'DDEV', color: 'var(--text-toned)' }

export function frameworkMeta(type?: string | null): FrameworkMeta {
  if (!type) return UNKNOWN_FRAMEWORK
  const t = type.toLowerCase()
  if (t.startsWith('drupal')) return { label: 'Drupal', color: '#7aa8d8' }
  return FRAMEWORKS[t] ?? { label: type.toUpperCase(), color: 'var(--text-toned)' }
}

// Workflow step "kind" → accent colour, shared by the builder and the overview
// step chain. det = deterministic, ai = agent, out = output, flow = control
// flow (if/loop), trigger.
export type StepKind = 'det' | 'ai' | 'out' | 'flow' | 'trigger'

export const STEP_KIND_COLOR: Record<StepKind, string> = {
  det: 'var(--text-toned)',
  ai: 'var(--accent-orange)',
  out: 'var(--primary)',
  flow: 'var(--accent-violet)',
  trigger: 'var(--accent-violet)',
}

// A workflow step as returned by /api/workflows: the shared step model
// (shared/utils/workflow.ts) under the name the app code grew up with.
// Presentation of a step instance lives with its def: workflowStepMeta
// (~/utils/workflow-steps.ts) reads the per-step registry.
export type WorkflowStep = Step

// Human-readable message from a failed `$fetch` call. H3 packs it into
// `error.data.statusMessage`; returns `fallback` when the response has none.
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

// Compact relative time ("4m ago", "2h ago"). Accepts a Date, epoch seconds,
// or an ISO string; returns '' for nullish input.
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

// Compact run duration ("42s", "3m 12s", "1h 04m"). A missing end measures
// against now (a still-running run); returns '' when the run never started.
export function runDuration(start: TimeValue, end: TimeValue): string {
  const from = toDate(start)
  if (!from) return ''
  const to = toDate(end) ?? new Date()
  const seconds = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ${seconds % 60}s`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${String(mins % 60).padStart(2, '0')}m`
}
