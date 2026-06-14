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

// A workflow step as returned by /api/workflows.
export type WorkflowStep
  = | { type: 'ddev-start' }
    | { type: 'bash', command: string, continueOnError?: boolean }

export interface StepMeta {
  icon: string
  kind: StepKind
  label: string
  detail: string
}

// Map a real workflow step to an icon + label, inferring intent from the shell
// command so the step chain reflects what the step actually does.
export function workflowStepMeta(step: WorkflowStep): StepMeta {
  if (step.type === 'ddev-start') {
    return { icon: 'i-lucide-play', kind: 'det', label: 'Boot project', detail: 'DDEV starts web + database' }
  }
  const cmd = step.command
  const c = cmd.toLowerCase()
  if (c.includes('composer')) return { icon: 'i-lucide-package', kind: 'det', label: 'Composer', detail: cmd }
  if (/\b(npm|pnpm|yarn)\b|build/.test(c)) return { icon: 'i-lucide-hammer', kind: 'det', label: 'Build assets', detail: cmd }
  if (/test|phpunit|playwright|pest/.test(c)) return { icon: 'i-lucide-flask-conical', kind: 'det', label: 'Run tests', detail: cmd }
  if (/\bgit\b|gh pr|pull request/.test(c)) return { icon: 'i-lucide-git-pull-request', kind: 'out', label: 'Pull request', detail: cmd }
  return { icon: 'i-lucide-terminal', kind: 'det', label: 'Shell', detail: cmd }
}

// Compact relative time ("4m ago", "2h ago"). Accepts a Date, epoch seconds,
// or an ISO string; returns '' for nullish input.
export function timeAgo(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' ? value * 1000 : value)
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (Number.isNaN(seconds)) return ''
  if (seconds < 60) return 'just now'
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
