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

// The env belongs to the session, so every run in it shows the env once one
// exists. Only while nothing is booted yet does the run's own boot step count.
export function runHasEnv(tier: SessionTier, steps: Step[] | null | undefined): boolean {
  return tier === 'preview' || stepsInclude(steps ?? [], 'ddev-start')
}
