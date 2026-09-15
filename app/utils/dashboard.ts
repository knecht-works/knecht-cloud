import type { Step } from '#shared/utils/workflow'
import type { IntegrationId, ObjectKind } from '#shared/utils/integrations'

export type RunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

type DotColor = 'primary' | 'orange' | 'neutral' | 'error'

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

export function triggerSourceMeta(source: string): TriggerSourceMeta {
  return TRIGGER_SOURCE_META[source] ?? { icon: 'i-lucide-zap', label: source, color: 'var(--accent-violet)' }
}

export type SessionObjectKind = ObjectKind

interface SessionObjectMeta {
  icon: string
  closedIcon: string
  label: string
  color: string
  // Rendered before the key: "#12" for GitHub, "PROJ-12" for Jira.
  prefix: string
}

const SESSION_OBJECT_META: Record<string, SessionObjectMeta> = {
  'github:issue': { icon: 'i-lucide-circle-dot', closedIcon: 'i-lucide-circle-check', label: 'Issue', color: 'var(--text-primary)', prefix: '#' },
  'github:pull_request': { icon: 'i-lucide-git-pull-request', closedIcon: 'i-lucide-git-pull-request-closed', label: 'PR', color: 'var(--accent-violet)', prefix: '#' },
  'jira:issue': { icon: 'i-simple-icons-jira', closedIcon: 'i-lucide-circle-check', label: 'Ticket', color: '#579dff', prefix: '' },
}

const UNKNOWN_OBJECT: SessionObjectMeta = { icon: 'i-lucide-circle-dot', closedIcon: 'i-lucide-circle-check', label: 'Object', color: 'var(--text-toned)', prefix: '' }

export function sessionObjectMeta(integration: IntegrationId, kind: SessionObjectKind): SessionObjectMeta {
  return SESSION_OBJECT_META[`${integration}:${kind}`] ?? UNKNOWN_OBJECT
}

interface SessionRunRow {
  sessionId: number
  objectIntegration: IntegrationId | null
  objectKind: SessionObjectKind | null
  objectKey: string | null
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
      object: head.objectIntegration && head.objectKind
        ? {
            integration: head.objectIntegration,
            kind: head.objectKind,
            key: head.objectKey,
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
