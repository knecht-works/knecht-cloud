import { stepsInclude, type Step } from './workflow'

export const ENV_STATES = ['down', 'up', 'stopped', 'archived'] as const
export type EnvState = (typeof ENV_STATES)[number]

// code: a checkout in a lightweight container. preview: booted by a ddev-start step. Only ever grows.
export const SESSION_TIERS = ['code', 'preview'] as const
export type SessionTier = (typeof SESSION_TIERS)[number]

export type RunDiagnosis
  = | { state: 'pending' }
    | { state: 'done', summary: string, steps: { id: number, stepId: string, label: string }[] }

export const ENV_TRANSITIONS = ['booting', 'stopping', 'rebooting', 'restoring', 'archiving', 'expiring'] as const
export type EnvTransition = (typeof ENV_TRANSITIONS)[number]

const CANCELLABLE: EnvTransition[] = ['booting', 'rebooting', 'restoring']

export function cancellable(operation: EnvTransition | null): boolean {
  return !!operation && CANCELLABLE.includes(operation)
}

export type EnvAction = 'terminal' | 'ide' | 'stop' | 'archive' | 'reboot' | 'restore' | 'startPreview' | 'bootPreview' | 'cancel'

export interface EnvActionInput {
  envState: EnvState
  operation: EnvTransition | null
  // A run or follow-up of the session is executing.
  working: boolean
  hasEnv: boolean
  previewReady: boolean
  previewLost: boolean
}

// A session becomes a preview only once its boot finishes, so a stopped half-boot is retried, not rebooted.
export function bootUnfinished({ hasEnv, previewReady, previewLost }: Pick<EnvActionInput, 'hasEnv' | 'previewReady' | 'previewLost'>): boolean {
  return hasEnv && !previewReady && !previewLost
}

// What the dashboard offers for a session's environment. While an operation runs, at most its cancel: anything else would only queue.
// A run's own operation is cancelled with the run.
export function envActions(input: EnvActionInput): EnvAction[] {
  const { envState, operation, working, hasEnv, previewLost } = input
  if (operation) return cancellable(operation) && !working ? ['cancel'] : []
  const unfinished = bootUnfinished(input)
  const actions: EnvAction[] = []
  if (envState === 'up') actions.push('terminal')
  if (envState === 'up' && !working) actions.push('ide', 'stop')
  if (envState === 'stopped') actions.push('archive')
  if (envState === 'stopped' && !working && !unfinished) actions.push('reboot')
  if (envState === 'archived' && !working) actions.push('restore')
  if (!hasEnv && !previewLost && !working) actions.push('startPreview')
  if (envState === 'up' && previewLost && !working) actions.push('bootPreview')
  return actions
}

// A run that only boots the preview leaves nothing to finish once cancelled: the cancel put the session back as it was.
export function runRolledBack(run: { status: string, steps: Step[] | null }): boolean {
  return run.status === 'cancelled' && (run.steps ?? []).every(s => s.type === 'ddev-start')
}

// A cancelled workflow run is retried to finish its steps first. A cancelled mention is just a turn that ended.
export function cancelledRunBlocksFollowups(run: { status: string, kind: 'workflow' | 'mention', steps: Step[] | null }): boolean {
  return run.status === 'cancelled' && run.kind !== 'mention' && !runRolledBack(run)
}

// The env belongs to the session, so every run in it shows the env once one
// exists. Only while nothing is booted yet does the run's own boot step count,
// and not once the run is cancelled: the cancel put the session back as it was.
export function runHasEnv(tier: SessionTier, steps: Step[] | null | undefined, cancelled = false): boolean {
  return tier === 'preview' || (!cancelled && stepsInclude(steps ?? [], 'ddev-start'))
}
