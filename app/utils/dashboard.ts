// Shared display helpers for the dashboard screens — keeps status mapping and
// formatting in one place so the screens stay free of ad-hoc logic.

export type RunStatus = 'queued' | 'running' | 'success' | 'failed'

export type DotColor = 'primary' | 'orange' | 'neutral' | 'error'

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
}

// "Ready / no runs yet" state for a project that has never been run.
export const IDLE_STATUS_META: RunStatusMeta = {
  dot: 'neutral',
  pulse: false,
  text: 'var(--text-dimmed)',
  label: 'No runs yet',
}

// Coloured by run state for the badge in the runs list.
export const RUN_BADGE_COLOR: Record<RunStatus, 'neutral' | 'info' | 'success' | 'error'> = {
  queued: 'neutral',
  running: 'info',
  success: 'success',
  failed: 'error',
}

// Framework presentation, keyed by the DDEV project `type` read from the repo's
// `.ddev/config.yaml`. Drives the label + accent colour across the dashboard.
export interface FrameworkMeta {
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
// step chain. det = deterministic, ai = agent, out = output, trigger.
export type StepKind = 'det' | 'ai' | 'out' | 'trigger'

export const STEP_KIND_COLOR: Record<StepKind, string> = {
  det: 'var(--text-toned)',
  ai: 'var(--accent-orange)',
  out: 'var(--primary)',
  trigger: 'var(--accent-violet)',
}

// A workflow step as returned by /api/workflows. `label`/`description` are the
// optional per-step name + note the builder can set.
export type WorkflowStep = { label?: string, description?: string } & (
  | { type: 'ddev-start' }
  | { type: 'bash', command: string, continueOnError?: boolean }
  | { type: 'create-branch', name: string }
  | { type: 'create-commit', message: string }
  | { type: 'create-pr', title: string, body: string }
)

export interface StepMeta {
  icon: string
  kind: StepKind
  label: string
  detail: string
}

// Map a step to an icon + label/detail. A custom `label`/`description` wins;
// otherwise both are inferred from the step type and shell command.
export function workflowStepMeta(step: WorkflowStep): StepMeta {
  const m = deriveStepMeta(step)
  return {
    ...m,
    label: step.label?.trim() || m.label,
    detail: step.description?.trim() || m.detail,
  }
}

function deriveStepMeta(step: WorkflowStep): StepMeta {
  if (step.type === 'ddev-start') {
    return { icon: 'i-lucide-play', kind: 'det', label: 'Boot project', detail: 'DDEV starts web + database' }
  }
  if (step.type === 'create-branch') {
    return { icon: 'i-lucide-git-branch', kind: 'out', label: 'Create branch', detail: step.name }
  }
  if (step.type === 'create-commit') {
    return { icon: 'i-lucide-git-commit-horizontal', kind: 'out', label: 'Create commit', detail: step.message }
  }
  if (step.type === 'create-pr') {
    return { icon: 'i-lucide-git-pull-request', kind: 'out', label: 'Open pull request', detail: step.title }
  }
  const cmd = step.command
  const c = cmd.toLowerCase()
  if (c.includes('composer')) return { icon: 'i-lucide-package', kind: 'det', label: 'Composer', detail: cmd }
  if (/\b(npm|pnpm|yarn)\b|build/.test(c)) return { icon: 'i-lucide-hammer', kind: 'det', label: 'Build assets', detail: cmd }
  if (/test|phpunit|playwright|pest/.test(c)) return { icon: 'i-lucide-flask-conical', kind: 'det', label: 'Run tests', detail: cmd }
  if (/\bgit\b|gh pr|pull request/.test(c)) return { icon: 'i-lucide-git-pull-request', kind: 'out', label: 'Pull request', detail: cmd }
  return { icon: 'i-lucide-terminal', kind: 'det', label: 'Shell', detail: cmd }
}

// Human-readable message from a failed `$fetch` call — H3 packs it into
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
