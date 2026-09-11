import { stepsInclude, type Step } from './workflow'

export const ENV_STATES = ['down', 'up', 'stopped', 'archived'] as const
export type EnvState = (typeof ENV_STATES)[number]

export const ENV_TRANSITIONS = ['stopping', 'rebooting', 'restoring', 'archiving'] as const
export type EnvTransition = (typeof ENV_TRANSITIONS)[number]

// The env belongs to the session, so every run in it shows the env once one
// exists. Only while nothing is booted yet does the run's own boot step count.
export function runHasEnv(envState: EnvState, steps: Step[] | null | undefined): boolean {
  return envState !== 'down' || stepsInclude(steps ?? [], 'ddev-start')
}
