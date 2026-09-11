export const ENV_STATES = ['down', 'up', 'stopped', 'archived'] as const
export type EnvState = (typeof ENV_STATES)[number]

export const ENV_TRANSITIONS = ['stopping', 'rebooting', 'restoring', 'archiving'] as const
export type EnvTransition = (typeof ENV_TRANSITIONS)[number]
