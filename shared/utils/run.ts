// A run environment's lifecycle states. server/daemon/envs.ts owns the
// transitions, the UI renders them. One source so the two sides can't drift.
export const ENV_STATES = ['down', 'up', 'stopped', 'archived'] as const
export type EnvState = (typeof ENV_STATES)[number]
